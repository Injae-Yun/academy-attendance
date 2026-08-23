/**
 * Repo.gs — 시트 읽기/쓰기 계층.
 *
 * 이 파일 밖에서는 getRange/setValues 를 직접 부르지 않는다.
 * 좌표 상수를 한곳에 가두고, 배치 읽기·쓰기로 호출 수를 줄인다.
 */

/* ── 공통 ─────────────────────────────────────────────────────────── */

/**
 * 시트의 데이터 영역을 2차원 배열로 읽는다.
 * @param {Sheet} sh
 * @param {number} firstRow 1-based
 * @param {number=} lastCol 없으면 시트의 마지막 열
 * @return {Array<Array<*>>} 행이 없으면 빈 배열
 */
function readRows_(sh, firstRow, lastCol) {
  var last = sh.getLastRow();
  if (last < firstRow) return [];
  var cols = lastCol || sh.getLastColumn();
  if (cols < 1) return [];
  return sh.getRange(firstRow, 1, last - firstRow + 1, cols).getValues();
}

/** 배열 인덱스로 안전하게 셀 값을 꺼낸다 (1-based 열 번호) */
function cell_(row, col) {
  if (!row || col < 1 || col > row.length) return '';
  var v = row[col - 1];
  return v === null || v === undefined ? '' : v;
}

/**
 * 시트 맨 아래에 여러 행을 한 번에 덧붙인다.
 * @param {Sheet} sh
 * @param {Array<Array<*>>} rows
 */
function appendRows_(sh, rows) {
  if (!rows || !rows.length) return;
  var width = 0;
  rows.forEach(function (r) { if (r.length > width) width = r.length; });
  var padded = rows.map(function (r) {
    var copy = r.slice();
    while (copy.length < width) copy.push('');
    return copy;
  });
  sh.getRange(sh.getLastRow() + 1, 1, padded.length, width).setValues(padded);
}

/** 헤더 행만 남기고 데이터 영역을 지운다 */
function clearBelow_(sh, firstDataRow) {
  var last = sh.getLastRow();
  if (last < firstDataRow) return;
  sh.getRange(firstDataRow, 1, last - firstDataRow + 1, sh.getMaxColumns()).clearContent();
}

/**
 * 시트를 만들거나 가져온다. 새로 만들면 헤더를 넣고 굵게 표시한다.
 * @return {{sheet: Sheet, created: boolean}}
 */
function ensureSheet_(name, headers) {
  var s = ss_();
  var sh = s.getSheetByName(name);
  if (sh) return { sheet: sh, created: false };

  sh = s.insertSheet(name);
  if (headers && headers.length) {
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setFontWeight('bold')
      .setBackground('#f0f0f0');
    sh.setFrozenRows(1);
  }
  return { sheet: sh, created: true };
}

/** 스크립트 락을 잡고 실행한다. 태블릿 동시 입력을 직렬화한다. */
function withLock_(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(timeoutMs || 20000)) {
    throw new Error('다른 작업이 진행 중입니다. 잠시 후 다시 시도해주세요.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/* ── 명단 3종 읽기 ────────────────────────────────────────────────── */

/**
 * 명단 한 행을 공통 형태로 바꾼다.
 * @return {{이름, 과목, 보호자연락처, 등록일, 행}}
 */
function parseRosterRow_(row, rowNum, layout) {
  return {
    이름: str_(cell_(row, layout.col.이름)),
    과목: str_(cell_(row, layout.col.과목)),
    보호자연락처: normalizePhone_(cell_(row, layout.col.보호자연락처)),
    등록일: toDate_(cell_(row, layout.col.등록일)),
    행: rowNum
  };
}

/** 수강생명단(재원생) 전체 */
function readActiveRoster_() {
  var sh = sheet_(SHEET.수강생명단);
  var rows = readRows_(sh, ROSTER_LAYOUT.firstDataRow);
  var out = [];
  rows.forEach(function (row, i) {
    var rec = parseRosterRow_(row, ROSTER_LAYOUT.firstDataRow + i, ROSTER_LAYOUT);
    if (!rec.이름) return;
    rec.상태 = ST.재원;
    rec.보호자성함 = str_(cell_(row, ROSTER_LAYOUT.col.보호자성함));
    rec.메모 = str_(cell_(row, ROSTER_LAYOUT.col.메모));
    out.push(rec);
  });
  return out;
}

/** 휴원생명단. 휴원 구간을 함께 돌려준다. */
function readLeaveRoster_() {
  var sh = sheet_(SHEET.휴원생명단, true);
  if (!sh) return [];
  var rows = readRows_(sh, LEAVE_LAYOUT.firstDataRow);
  var out = [];
  rows.forEach(function (row, i) {
    var rec = parseRosterRow_(row, LEAVE_LAYOUT.firstDataRow + i, LEAVE_LAYOUT);
    if (!rec.이름) return;
    rec.상태 = ST.휴원;
    rec.휴원시작일 = toDate_(cell_(row, LEAVE_LAYOUT.col.휴원시작일));
    rec.휴원종료일 = toDate_(cell_(row, LEAVE_LAYOUT.col.휴원종료일));
    out.push(rec);
  });
  return out;
}

/** 퇴소생명단 */
function readQuitRoster_() {
  var sh = sheet_(SHEET.퇴소생명단, true);
  if (!sh) return [];
  var rows = readRows_(sh, QUIT_LAYOUT.firstDataRow);
  var out = [];
  rows.forEach(function (row, i) {
    var rec = parseRosterRow_(row, QUIT_LAYOUT.firstDataRow + i, QUIT_LAYOUT);
    if (!rec.이름) return;
    rec.상태 = ST.퇴소;
    rec.퇴소일 = toDate_(cell_(row, QUIT_LAYOUT.col.퇴소일));
    out.push(rec);
  });
  return out;
}

/**
 * 수강생명단의 보호자 연락처 한 칸을 갱신한다.
 * 앱에서 연락처를 수집할 때만 쓰며, 다른 열은 절대 건드리지 않는다.
 */
function writeRosterPhone_(rowNum, phone) {
  var sh = sheet_(SHEET.수강생명단);
  sh.getRange(rowNum, ROSTER_LAYOUT.col.보호자연락처).setValue(formatPhone_(phone));
}

/* ── _출결_학생 ──────────────────────────────────────────────────── */

/** 시트 행 → 학생 객체 */
function parseStudentRow_(row, rowNum) {
  return {
    학생ID: str_(cell_(row, STUDENT_COL.학생ID)),
    이름: str_(cell_(row, STUDENT_COL.이름)),
    표시명: str_(cell_(row, STUDENT_COL.표시명)),
    과목: str_(cell_(row, STUDENT_COL.과목)),
    등록일: toDate_(cell_(row, STUDENT_COL.등록일)),
    보호자연락처: normalizePhone_(cell_(row, STUDENT_COL.보호자연락처)),
    알림수신: bool_(cell_(row, STUDENT_COL.알림수신)),
    PIN: str_(cell_(row, STUDENT_COL.PIN)),
    출석부행: str_(cell_(row, STUDENT_COL.출석부행)),
    상태: str_(cell_(row, STUDENT_COL.상태)),
    행: rowNum
  };
}

/** 학생 객체 → 시트 행 배열 */
function studentToRow_(s) {
  var row = [];
  row[STUDENT_COL.학생ID - 1] = s.학생ID;
  row[STUDENT_COL.이름 - 1] = s.이름;
  row[STUDENT_COL.표시명 - 1] = s.표시명;
  row[STUDENT_COL.과목 - 1] = s.과목;
  row[STUDENT_COL.등록일 - 1] = s.등록일 ? fmtDate_(s.등록일) : '';
  row[STUDENT_COL.보호자연락처 - 1] = s.보호자연락처 ? formatPhone_(s.보호자연락처) : '';
  row[STUDENT_COL.알림수신 - 1] = !!s.알림수신;
  row[STUDENT_COL.PIN - 1] = s.PIN || '';
  row[STUDENT_COL.출석부행 - 1] = s.출석부행 || '';
  row[STUDENT_COL.상태 - 1] = s.상태;
  row[STUDENT_COL.동기화시각 - 1] = fmtStamp_(now_());
  for (var i = 0; i < STUDENT_HEADERS.length; i++) {
    if (row[i] === undefined) row[i] = '';
  }
  return row;
}

/** _출결_학생 전체를 읽는다. 퇴소·휴원도 포함한다 (접미사 대장이므로). */
function readStudents_() {
  var sh = sheet_(APP_SHEET.학생, true);
  if (!sh) return [];
  var rows = readRows_(sh, 2, STUDENT_HEADERS.length);
  var out = [];
  rows.forEach(function (row, i) {
    var s = parseStudentRow_(row, i + 2);
    if (s.학생ID) out.push(s);
  });
  return out;
}

/** 학생 목록을 통째로 다시 쓴다. 행을 지우지 않고 덮어쓰기만 한다. */
function writeStudents_(students) {
  var sh = sheet_(APP_SHEET.학생);
  if (!students.length) return;
  var rows = students.map(studentToRow_);
  sh.getRange(2, 1, rows.length, STUDENT_HEADERS.length).setValues(rows);
  // 알림수신 열을 체크박스로 유지
  sh.getRange(2, STUDENT_COL.알림수신, rows.length, 1).insertCheckboxes();
}

/** 학생 한 명의 특정 열만 갱신한다. */
function updateStudentCell_(rowNum, col, value) {
  sheet_(APP_SHEET.학생).getRange(rowNum, col).setValue(value);
}

/** 다음 학생ID 를 발급한다. 기존 최대 번호 + 1. */
function nextStudentId_(students) {
  var max = 0;
  students.forEach(function (s) {
    var n = parseSeqId_('S', s.학생ID);
    if (n > max) max = n;
  });
  return formatSeqId_('S', max + 1, 3);
}

/* ── _출결_로그 ──────────────────────────────────────────────────── */

function parseLogRow_(row, rowNum) {
  return {
    기록ID: str_(cell_(row, LOG_COL.기록ID)),
    입력시각: toDate_(cell_(row, LOG_COL.입력시각)),
    출결시각: toDate_(cell_(row, LOG_COL.출결시각)),
    학생ID: str_(cell_(row, LOG_COL.학생ID)),
    이름: str_(cell_(row, LOG_COL.이름)),
    구분: str_(cell_(row, LOG_COL.구분)),
    상태: str_(cell_(row, LOG_COL.상태)),
    기기: str_(cell_(row, LOG_COL.기기)),
    발송상태: str_(cell_(row, LOG_COL.발송상태)),
    발송채널: str_(cell_(row, LOG_COL.발송채널)),
    메시지ID: str_(cell_(row, LOG_COL.메시지ID)),
    발송시각: toDate_(cell_(row, LOG_COL.발송시각)),
    오류: str_(cell_(row, LOG_COL.오류)),
    비고: str_(cell_(row, LOG_COL.비고)),
    과목: str_(cell_(row, LOG_COL.과목)),
    행: rowNum
  };
}

/** 로그 전체를 읽는다. 건수가 많아지면 호출부에서 날짜로 걸러 쓴다. */
function readLogs_() {
  var sh = sheet_(APP_SHEET.로그, true);
  if (!sh) return [];
  var rows = readRows_(sh, 2, LOG_HEADERS.length);
  var out = [];
  rows.forEach(function (row, i) {
    var r = parseLogRow_(row, i + 2);
    if (r.기록ID) out.push(r);
  });
  return out;
}

/** 특정 날짜의 로그만 (원장 시트 대신 로그를 훑는다) */
function readLogsByDate_(dateStr) {
  return readLogs_().filter(function (r) {
    return r.출결시각 && fmtDate_(r.출결시각) === dateStr;
  });
}

/** 로그 한 건을 덧붙이고 기록ID 를 돌려준다. */
function appendLog_(rec) {
  var sh = sheet_(APP_SHEET.로그);
  var row = [];
  row[LOG_COL.기록ID - 1] = rec.기록ID;
  row[LOG_COL.입력시각 - 1] = fmtStamp_(rec.입력시각);
  row[LOG_COL.출결시각 - 1] = fmtStamp_(rec.출결시각);
  row[LOG_COL.학생ID - 1] = rec.학생ID;
  row[LOG_COL.이름 - 1] = rec.이름;
  row[LOG_COL.구분 - 1] = rec.구분;
  row[LOG_COL.상태 - 1] = rec.상태 || LOGST.정상;
  row[LOG_COL.기기 - 1] = rec.기기 || '';
  row[LOG_COL.발송상태 - 1] = rec.발송상태 || SENDST.대기;
  row[LOG_COL.발송채널 - 1] = '';
  row[LOG_COL.메시지ID - 1] = '';
  row[LOG_COL.발송시각 - 1] = '';
  row[LOG_COL.오류 - 1] = '';
  row[LOG_COL.비고 - 1] = rec.비고 || '';
  row[LOG_COL.과목 - 1] = rec.과목 || '';
  for (var i = 0; i < LOG_HEADERS.length; i++) if (row[i] === undefined) row[i] = '';
  appendRows_(sh, [row]);
  return rec.기록ID;
}

/** 다음 기록ID. 'L' + 6자리 */
function nextLogId_(logs) {
  var max = 0;
  logs.forEach(function (r) {
    var n = parseSeqId_('L', r.기록ID);
    if (n > max) max = n;
  });
  return formatSeqId_('L', max + 1, 6);
}

/** 로그 행의 특정 열들을 한 번에 갱신한다. {열번호: 값} */
function updateLogCells_(rowNum, colValueMap) {
  var sh = sheet_(APP_SHEET.로그);
  Object.keys(colValueMap).forEach(function (col) {
    sh.getRange(rowNum, Number(col)).setValue(colValueMap[col]);
  });
}

/* ── _출결_이력 ──────────────────────────────────────────────────── */

/**
 * 감사 로그를 남긴다.
 * @param {{대상기록ID, 작업, 필드, 이전값, 이후값, 수행자, 사유}} h
 */
function appendHistory_(h) {
  var sh = sheet_(APP_SHEET.이력, true);
  if (!sh) return;
  var last = sh.getLastRow();
  var id = formatSeqId_('H', Math.max(0, last - 1) + 1, 6);
  var row = [];
  row[HISTORY_COL.이력ID - 1] = id;
  row[HISTORY_COL.시각 - 1] = fmtStamp_(now_());
  row[HISTORY_COL.대상기록ID - 1] = h.대상기록ID || '';
  row[HISTORY_COL.작업 - 1] = h.작업 || '';
  row[HISTORY_COL.필드 - 1] = h.필드 || '';
  row[HISTORY_COL.이전값 - 1] = h.이전값 === undefined ? '' : String(h.이전값);
  row[HISTORY_COL.이후값 - 1] = h.이후값 === undefined ? '' : String(h.이후값);
  row[HISTORY_COL.수행자 - 1] = h.수행자 || '';
  row[HISTORY_COL.사유 - 1] = h.사유 || '';
  for (var i = 0; i < HISTORY_HEADERS.length; i++) if (row[i] === undefined) row[i] = '';
  appendRows_(sh, [row]);
}

/* ── _출결_기기 ──────────────────────────────────────────────────── */

function readDevices_() {
  var sh = sheet_(APP_SHEET.기기, true);
  if (!sh) return [];
  var rows = readRows_(sh, 2, DEVICE_HEADERS.length);
  var out = [];
  rows.forEach(function (row, i) {
    var token = str_(cell_(row, DEVICE_COL.토큰));
    if (!token) return;
    out.push({
      토큰: token,
      별명: str_(cell_(row, DEVICE_COL.별명)),
      모드: str_(cell_(row, DEVICE_COL.모드)),
      활성: bool_(cell_(row, DEVICE_COL.활성)),
      행: i + 2
    });
  });
  return out;
}

function appendDevice_(token, label, mode) {
  var sh = sheet_(APP_SHEET.기기);
  var row = [];
  row[DEVICE_COL.토큰 - 1] = token;
  row[DEVICE_COL.별명 - 1] = label;
  row[DEVICE_COL.모드 - 1] = mode;
  row[DEVICE_COL.등록일 - 1] = fmtStamp_(now_());
  row[DEVICE_COL.마지막사용 - 1] = fmtStamp_(now_());
  row[DEVICE_COL.활성 - 1] = true;
  appendRows_(sh, [row]);
}

function touchDevice_(rowNum) {
  sheet_(APP_SHEET.기기).getRange(rowNum, DEVICE_COL.마지막사용).setValue(fmtStamp_(now_()));
}
