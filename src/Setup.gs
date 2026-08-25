/**
 * Setup.gs — 최초 1회 설치와 기존 시트 좌표 실측.
 *
 * 기존 시트는 시판 템플릿이라 행 위치가 버전에 따라 밀릴 수 있다.
 * 좌표를 코드에 박아두면 조용히 엉뚱한 칸을 건드리게 되므로,
 * probeLayout() 이 헤더 텍스트를 찾아 실제 좌표를 구하고 저장한다.
 */

/** 설치 진입점. 커스텀 메뉴에서 실행한다. */
function setup() {
  var report = [];
  report.push(probeLayout());
  report.push(initializeAppSheets());
  var text = report.join('\n\n');
  Logger.log(text);
  try {
    SpreadsheetApp.getUi().alert('출결 시스템 설치', text, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // 메뉴가 아닌 곳에서 실행된 경우 UI 가 없다. 로그로 충분하다.
  }
  return text;
}

/* ── 좌표 실측 ────────────────────────────────────────────────────── */

/**
 * 시트에서 헤더 행을 찾는다.
 * 지정한 라벨들이 "한 행에 모두" 등장하는 첫 행을 헤더로 본다.
 *
 * @param {Sheet} sh
 * @param {string[]} labels 반드시 있어야 하는 헤더 라벨
 * @param {number=} scanRows 훑을 행 수 (기본 12)
 * @return {{row: number, cols: Object}|null} cols 는 라벨→열번호(1-based)
 */
function findHeaderRow_(sh, labels, scanRows) {
  var maxRow = Math.min(sh.getLastRow(), scanRows || 12);
  var maxCol = Math.min(sh.getLastColumn(), 45);
  if (maxRow < 1 || maxCol < 1) return null;

  var values = sh.getRange(1, 1, maxRow, maxCol).getValues();
  for (var r = 0; r < values.length; r++) {
    var found = {};
    var hitCount = 0;
    for (var c = 0; c < values[r].length; c++) {
      var text = str_(values[r][c]).replace(/\s+/g, '').replace(/\*/g, '');
      if (!text) continue;
      for (var li = 0; li < labels.length; li++) {
        var want = labels[li].replace(/\s+/g, '');
        if (found[labels[li]] === undefined && text === want) {
          found[labels[li]] = c + 1;
          hitCount++;
        }
      }
    }
    if (hitCount === labels.length) {
      return { row: r + 1, cols: found };
    }
  }
  return null;
}

/**
 * 헤더 행에서 숫자 1이 처음 나오는 열을 찾는다 (출석부의 '1일' 열).
 * @return {number} 못 찾으면 0
 */
function findDay1Col_(sh, headerRow, startAfterCol) {
  var maxCol = Math.min(sh.getLastColumn(), 45);
  var row = sh.getRange(headerRow, 1, 1, maxCol).getValues()[0];
  for (var c = startAfterCol; c < row.length; c++) {
    if (String(row[c]).trim() === '1') return c + 1;
  }
  return 0;
}

/** 시트 이름을 유연하게 찾는다. 정확히 없으면 정규화 비교로 재시도. */
function resolveSheetName_(candidate) {
  var s = ss_();
  if (s.getSheetByName(candidate)) return candidate;

  var norm = function (x) { return String(x).replace(/[\s()（）]/g, ''); };
  var target = norm(candidate);
  var names = s.getSheets().map(function (sh) { return sh.getName(); });
  for (var i = 0; i < names.length; i++) {
    if (norm(names[i]) === target) return names[i];
  }
  return null;
}

/**
 * 헤더 구조로 시트를 찾는다.
 *
 * 시트 이름은 학원마다 다를 수 있고 템플릿 버전에 따라서도 바뀐다.
 * 이름을 추측해 코드에 박으면 조용히 못 찾거나 엉뚱한 시트를 잡으므로,
 * "이 라벨들이 한 행에 모두 있는 시트" 로 역할을 판별한다.
 *
 * @param {string[]} required 반드시 있어야 하는 헤더 라벨 (전부 있어야 한다)
 * @param {string[]=} forbidden 하나라도 있으면 배제할 라벨 (비슷한 시트를 가려낼 때)
 * @param {number=} scanRows 훑을 행 수
 * @return {{name: string, sheet: Sheet, row: number, cols: Object}|null}
 */
function findSheetByHeaders_(required, forbidden, scanRows) {
  var sheets = ss_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var hit = findHeaderRow_(sheets[i], required, scanRows || 12);
    if (!hit) continue;
    if (hasForbiddenLabel_(sheets[i], hit.row, forbidden, scanRows)) continue;
    return { name: sheets[i].getName(), sheet: sheets[i], row: hit.row, cols: hit.cols };
  }
  return null;
}

/**
 * 헤더 행에 배제 라벨이 하나라도 있는지.
 * 수강생명단·휴원생명단·퇴소생명단은 앞부분이 똑같아서
 * 고유 열(휴원시작일/퇴소일)의 유무로만 갈린다.
 */
function hasForbiddenLabel_(sheet, headerRow, forbidden, scanRows) {
  if (!forbidden || !forbidden.length) return false;
  for (var i = 0; i < forbidden.length; i++) {
    var bad = findHeaderRow_(sheet, [forbidden[i]], scanRows || 12);
    if (bad && bad.row === headerRow) return true;
  }
  return false;
}

/**
 * 역할별로 시트를 확정한다.
 * 이름으로 먼저 찾아보고, 없으면 헤더 구조로 찾는다.
 *
 * @param {string} role SHEET 의 키
 * @param {string[]} required 헤더 라벨
 * @param {string[]=} forbidden 배제 라벨
 * @return {{name: string, byHeaders: boolean}|null}
 */
function resolveSheetRole_(role, required, forbidden) {
  var byName = resolveSheetName_(SHEET[role]);
  if (byName) {
    // 이름은 맞는데 헤더가 없으면 동명이 다른 시트일 수 있으니 확인한다
    var sh = ss_().getSheetByName(byName);
    if (!required) return { name: byName, byHeaders: false };
    var hit = findHeaderRow_(sh, required, 12);
    if (hit && !hasForbiddenLabel_(sh, hit.row, forbidden)) {
      return { name: byName, byHeaders: false };
    }
  }
  if (!required) return null;

  var found = findSheetByHeaders_(required, forbidden);
  return found ? { name: found.name, byHeaders: true } : null;
}

/**
 * 기존 시트의 실제 좌표를 찾아 Script Properties 에 저장한다.
 * 여러 번 실행해도 안전하다.
 * @return {string} 사람이 읽을 리포트
 */
function probeLayout() {
  var probed = { SHEET: {} };
  var lines = ['[좌표 실측]'];
  var warn = [];

  lines.push('  이 파일의 시트: ' +
    ss_().getSheets().map(function (sh) {
      return sh.getName() + (sh.isSheetHidden() ? '(숨김)' : '');
    }).join(' · '));
  lines.push('');

  /**
   * 역할별 시트 판별 규칙.
   * 이름이 달라도 헤더 구조로 찾아낸다. required 가 없으면 이름으로만 찾는다.
   */
  var ROLES = [
    { key: '기본정보', required: null },
    { key: '대시보드', required: null },
    { key: '수강생명단', required: ['이름', '과목', '보호자 연락처', '등록일'],
      forbidden: ['휴원시작일', '휴원종료일', '퇴소일', '최종수강기간', '연도'] },
    { key: '휴원생명단', required: ['이름', '과목', '등록일', '휴원시작일'] },
    { key: '퇴소생명단', required: ['이름', '과목', '등록일', '퇴소일'] },
    { key: '출석부', required: ['번호', '이름', '과목명', '수강요일'],
      forbidden: ['연도', '수강월'] },
    { key: '출석부누적', required: ['연도', '수강월', '번호', '이름', '과목명'] },
    { key: '지출원장', required: ['연도', '월', '예산구분', '사업항목', '금액'] },
    { key: '수강료누적', required: null },
    { key: '수강료월별', required: null },
    { key: '수입지출', required: null }
  ];

  var 필수 = { 수강생명단: 1, 출석부: 1, 출석부누적: 1 };

  ROLES.forEach(function (role) {
    var hit = resolveSheetRole_(role.key, role.required, role.forbidden);
    if (!hit) {
      var msg = '  ! "' + SHEET[role.key] + '" 역할의 시트를 찾지 못했습니다';
      if (role.required) {
        msg += ' (찾는 헤더: ' + role.required.join(', ') + ')';
      }
      if (필수[role.key]) msg += ' — 이 시트는 반드시 필요합니다';
      warn.push(msg);
      return;
    }
    probed.SHEET[role.key] = hit.name;
    if (hit.name !== SHEET[role.key]) {
      lines.push('  시트 확정: ' + SHEET[role.key] + ' → "' + hit.name + '"' +
        (hit.byHeaders ? ' (헤더 구조로 찾음)' : ''));
    }
  });
  mergeInto_(SHEET, probed.SHEET);

  // 2) 명단 3종
  var rosterLabels = ['이름', '과목', '보호자 연락처', '등록일'];
  var rosterTargets = [
    { key: 'ROSTER_LAYOUT', sheet: SHEET.수강생명단, extra: {} },
    { key: 'LEAVE_LAYOUT', sheet: SHEET.휴원생명단, extra: { 휴원시작일: '휴원시작일', 휴원종료일: '휴원종료일' } },
    { key: 'QUIT_LAYOUT', sheet: SHEET.퇴소생명단, extra: { 퇴소일: '퇴소일' } }
  ];
  rosterTargets.forEach(function (t) {
    var sh = sheet_(t.sheet, true);
    if (!sh) { warn.push('  ! ' + t.sheet + ' 없음'); return; }

    var labels = rosterLabels.concat(Object.keys(t.extra).map(function (k) { return t.extra[k]; }));
    var hit = findHeaderRow_(sh, labels);
    if (!hit) { warn.push('  ! ' + t.sheet + ' 헤더 행을 찾지 못했습니다'); return; }

    var cols = {
      이름: hit.cols['이름'],
      과목: hit.cols['과목'],
      보호자연락처: hit.cols['보호자 연락처'],
      등록일: hit.cols['등록일']
    };
    Object.keys(t.extra).forEach(function (k) { cols[k] = hit.cols[t.extra[k]]; });

    // 수강생명단은 쓰기 대상이 있으므로 부가 열도 확보한다
    if (t.key === 'ROSTER_LAYOUT') {
      var extraHit = findHeaderRow_(sh, ['보호자 성함', '메모']);
      if (extraHit) {
        cols.보호자성함 = extraHit.cols['보호자 성함'];
        cols.메모 = extraHit.cols['메모'];
      }
    }

    probed[t.key] = { headerRow: hit.row, firstDataRow: hit.row + 1, col: cols };
    lines.push('  ' + t.sheet + ': 헤더 ' + hit.row + '행, 데이터 ' + (hit.row + 1) + '행부터, 이름=' +
      colToA1_(cols.이름) + '열, 연락처=' + colToA1_(cols.보호자연락처) + '열');
  });

  // 3) 출석부
  var book = sheet_(SHEET.출석부, true);
  if (!book) {
    warn.push('  ! 출석부 없음');
  } else {
    var bh = findHeaderRow_(book, ['번호', '이름', '과목명', '수강요일']);
    if (!bh) {
      warn.push('  ! 출석부 헤더 행을 찾지 못했습니다');
    } else {
      var d1 = findDay1Col_(book, bh.row, bh.cols['수강요일']);
      if (!d1) {
        warn.push('  ! 출석부에서 1일 열을 찾지 못했습니다');
      } else {
        var yc = findLabelValueCell_(book, '연도', 6);
        var mc = findLabelValueCell_(book, '수강월', 6);
        probed.BOOK_LAYOUT = {
          headerRow: bh.row,
          firstDataRow: bh.row + 1,
          weekdayRow: bh.row - 1,
          col: {
            번호: bh.cols['번호'],
            이름: bh.cols['이름'],
            과목명: bh.cols['과목명'],
            수강요일: bh.cols['수강요일']
          },
          day1Col: d1,
          특이사항Col: d1 + 31
        };
        if (yc) probed.BOOK_LAYOUT.yearCell = yc;
        if (mc) probed.BOOK_LAYOUT.monthCell = mc;
        lines.push('  출석부: 헤더 ' + bh.row + '행, 1일=' + colToA1_(d1) + '열, 31일=' +
          colToA1_(d1 + 30) + '열, 연도셀=' + (yc || '?') + ', 수강월셀=' + (mc || '?'));
      }
    }
  }

  // 4) 출석부(누적)
  var led = sheet_(SHEET.출석부누적, true);
  if (!led) {
    warn.push('  ! 출결 원장 시트를 찾지 못했습니다 — 최초 설치가 새로 만들어 줍니다');
  } else {
    var lh = findHeaderRow_(led, ['연도', '수강월', '번호', '이름', '과목명', '수강요일']);
    if (!lh) {
      warn.push('  ! 출석부(누적) 헤더 행을 찾지 못했습니다');
    } else {
      var ld1 = findDay1Col_(led, lh.row, lh.cols['수강요일']);
      probed.LEDGER_LAYOUT = {
        headerRow: lh.row,
        firstDataRow: lh.row + 1,
        col: {
          연도: lh.cols['연도'], 수강월: lh.cols['수강월'], 번호: lh.cols['번호'],
          이름: lh.cols['이름'], 과목명: lh.cols['과목명'], 수강요일: lh.cols['수강요일']
        },
        day1Col: ld1,
        특이사항Col: ld1 + 31
      };
      lines.push('  출석부(누적): 헤더 ' + lh.row + '행, 1일=' + colToA1_(ld1) + '열');
    }
  }

  // 5) 지출내역 원장
  var exp = sheet_(SHEET.지출원장, true);
  if (!exp) {
    warn.push('  ! 지출내역 원장 없음');
  } else {
    var eh = findHeaderRow_(exp, ['연도', '월', '예산구분', '사업항목', '금액']);
    if (!eh) {
      warn.push('  ! 지출내역 원장 헤더 행을 찾지 못했습니다');
    } else {
      probed.EXPENSE_LAYOUT = {
        headerRow: eh.row,
        firstDataRow: eh.row + 1,
        col: {
          연도: eh.cols['연도'], 월: eh.cols['월'], 예산구분: eh.cols['예산구분'],
          사업항목: eh.cols['사업항목'], 금액: eh.cols['금액'],
          비고: eh.cols['금액'] + 1
        }
      };
      lines.push('  ' + SHEET.지출원장 + ': 헤더 ' + eh.row + '행, 데이터 ' + (eh.row + 1) + '행부터');
    }
  }

  PropertiesService.getScriptProperties()
    .setProperty(LAYOUT_PROP_KEY, JSON.stringify(probed));
  applyProbedLayout_();

  if (warn.length) {
    lines.push('');
    lines.push('[확인 필요]');
    lines = lines.concat(warn);
  }
  return lines.join('\n');
}

/**
 * '연도 :' 같은 라벨 셀을 찾아 그 오른쪽 값 셀의 A1 주소를 돌려준다.
 * @return {string|null} 'H2' 형태
 */
function findLabelValueCell_(sh, label, scanRows) {
  var maxRow = Math.min(sh.getLastRow(), scanRows || 6);
  var maxCol = Math.min(sh.getLastColumn(), 20);
  if (maxRow < 1) return null;
  var values = sh.getRange(1, 1, maxRow, maxCol).getValues();
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      var text = str_(values[r][c]).replace(/[\s:：]/g, '');
      if (text === label) {
        return colToA1_(c + 2) + (r + 1);
      }
    }
  }
  return null;
}

/* ── 앱 시트 생성 ─────────────────────────────────────────────────── */

/**
 * _출결_* 시트를 만든다. 이미 있으면 건드리지 않는다.
 * @return {string} 리포트
 */
/**
 * 출결 원장(출석부 누적)이 아예 없으면 만든다.
 *
 * 이 시트는 모든 출결 기록이 쌓이는 곳이라 없으면 시스템이 동작하지 않는다.
 * 템플릿 버전에 따라 없을 수 있으므로 같은 구조로 새로 만든다.
 * probeLayout() 이 다른 이름으로 이미 찾았다면 건드리지 않는다.
 *
 * @return {string|null} 만들었으면 안내 문구
 */
function ensureLedgerSheet_() {
  if (sheet_(SHEET.출석부누적, true)) return null;

  var headers = ['연도', '수강월', '번호', '이름', '과목명', '수강요일'];
  for (var d = 1; d <= 31; d++) headers.push(d);
  headers.push('특이사항');

  var sh = ss_().insertSheet('출석부(누적)');
  sh.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#f0f0f0');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(4);

  SHEET.출석부누적 = '출석부(누적)';
  LEDGER_LAYOUT.headerRow = 1;
  LEDGER_LAYOUT.firstDataRow = 2;
  LEDGER_LAYOUT.col = { 연도: 1, 수강월: 2, 번호: 3, 이름: 4, 과목명: 5, 수강요일: 6 };
  LEDGER_LAYOUT.day1Col = 7;
  LEDGER_LAYOUT.특이사항Col = 38;

  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(LAYOUT_PROP_KEY);
  var probed = raw ? JSON.parse(raw) : {};
  probed.SHEET = probed.SHEET || {};
  probed.SHEET.출석부누적 = '출석부(누적)';
  probed.LEDGER_LAYOUT = {
    headerRow: 1, firstDataRow: 2,
    col: LEDGER_LAYOUT.col, day1Col: 7, 특이사항Col: 38
  };
  props.setProperty(LAYOUT_PROP_KEY, JSON.stringify(probed));

  return '출결 원장이 없어 "출석부(누적)" 시트를 새로 만들었습니다.';
}

/**
 * 로그 시트에 나중에 추가된 열을 채운다.
 *
 * 이미 설치된 시트에는 '과목' 열이 없다. 헤더만 채워 넣으면
 * 기존 행은 그대로 두고 새 행부터 값이 들어간다.
 *
 * @return {string[]} 추가한 열 이름
 */
function ensureLogColumns_() {
  var sh = sheet_(APP_SHEET.로그, true);
  if (!sh) return [];

  var width = Math.max(sh.getLastColumn(), 1);
  var head = sh.getRange(1, 1, 1, Math.max(width, LOG_HEADERS.length)).getValues()[0];

  var added = [];
  for (var i = 0; i < LOG_HEADERS.length; i++) {
    if (str_(head[i]) !== LOG_HEADERS[i]) {
      sh.getRange(1, i + 1).setValue(LOG_HEADERS[i]).setFontWeight('bold');
      if (!str_(head[i])) added.push(LOG_HEADERS[i]);
    }
  }
  return added;
}

function initializeAppSheets() {
  var lines = ['[앱 시트 생성]'];

  var ledgerMsg = ensureLedgerSheet_();
  if (ledgerMsg) lines.push('  ' + ledgerMsg);

  var specs = [
    { name: APP_SHEET.학생, headers: STUDENT_HEADERS },
    { name: APP_SHEET.로그, headers: LOG_HEADERS },
    { name: APP_SHEET.기기, headers: DEVICE_HEADERS },
    { name: APP_SHEET.설정, headers: SETTING_HEADERS },
    { name: APP_SHEET.이력, headers: HISTORY_HEADERS }
  ];

  specs.forEach(function (spec) {
    var r = ensureSheet_(spec.name, spec.headers);
    lines.push('  ' + spec.name + ': ' + (r.created ? '생성됨' : '이미 있음'));
  });

  var added = ensureSettingKeys_();
  if (added.length) lines.push('  설정 항목 ' + added.length + '건 추가: ' + added.join(', '));
  protectMessageTemplates_();

  var logCols = ensureLogColumns_();
  if (logCols.length) lines.push('  로그 열 추가: ' + logCols.join(', '));

  // 기기 시트만 숨긴다. 설정 시트는 사람이 고쳐야 하므로 보이게 둔다.
  HIDDEN_APP_SHEETS.forEach(function (name) {
    var sh = sheet_(name, true);
    if (sh && !sh.isSheetHidden()) sh.hideSheet();
  });
  var settingSh = sheet_(APP_SHEET.설정, true);
  if (settingSh && settingSh.isSheetHidden()) settingSh.showSheet();
  lines.push('  기기 시트 숨김 · 설정 시트 표시');

  // 학생 시트 알림수신 열을 체크박스로
  var stu = sheet_(APP_SHEET.학생);
  if (stu.getMaxRows() > 1) {
    stu.getRange(2, STUDENT_COL.알림수신, stu.getMaxRows() - 1, 1).insertCheckboxes();
  }

  return lines.join('\n');
}

/**
 * 설정 시트에 빠진 키를 채운다.
 *
 * 나중에 추가된 설정 항목이 기존 시트에는 없다.
 * 설치를 다시 하지 않아도 되도록, 설정을 열 때마다 이 함수가 메운다.
 *
 * @return {string[]} 새로 추가한 키 목록
 */
/**
 * 설정 한 칸을 쓴다. 키가 없으면 새 행을 만든다.
 *
 * ensureSettingKeys_ 는 최초 설치 때만 도는데, 웹앱 주소처럼 나중에
 * 등록하는 값은 그때 시트에 행이 없을 수 있다. 그래서 upsert 로 둔다.
 */
function writeSetting_(key, value) {
  var sh = sheet_(APP_SHEET.설정, true);
  if (!sh) throw new Error('_출결_설정 시트가 없습니다. [최초 설치] 를 먼저 실행해주세요.');

  var row = 0;
  if (sh.getLastRow() > 1) {
    var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) { row = i + 2; break; }
    }
  }

  if (row) {
    sh.getRange(row, 2).setValue(value);
  } else {
    var desc = SETTING_DEFAULTS[key] ? SETTING_DEFAULTS[key][1] : '';
    appendRows_(sh, [[key, value, desc]]);
  }
  clearSettingsCache_();
}

function ensureSettingKeys_() {
  var sh = sheet_(APP_SHEET.설정, true);
  if (!sh) return [];

  var existing = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
      .forEach(function (r) { if (r[0]) existing[String(r[0]).trim()] = true; });
  }

  var toAdd = [];
  Object.keys(SETTING_DEFAULTS).forEach(function (k) {
    if (!existing[k]) toAdd.push([k, SETTING_DEFAULTS[k][0], SETTING_DEFAULTS[k][1]]);
  });
  if (toAdd.length) appendRows_(sh, toAdd);
  clearSettingsCache_();

  return toAdd.map(function (r) { return r[0]; });
}

/**
 * 문구 칸에 경고형 보호를 건다.
 *
 * 막지는 않는다. 알림톡 템플릿을 새로 심사받으면 오히려 고쳐야 하기 때문이다.
 * 대신 수정하려 할 때 확인 창이 떠서, 모르고 건드리는 일을 막는다.
 */
function protectMessageTemplates_() {
  var sh = sheet_(APP_SHEET.설정, true);
  if (!sh || sh.getLastRow() < 2) return;

  var keys = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  var rows = [];
  keys.forEach(function (r, i) {
    var k = String(r[0]).trim();
    if (k === '문구_등원' || k === '문구_하원') rows.push(i + 2);
  });
  if (!rows.length) return;

  // 이미 걸어둔 보호는 지우고 다시 건다 (행 위치가 바뀌었을 수 있다).
  // 순회 중에 remove() 하면 목록이 흔들리므로 복사본을 돈다.
  var old = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).slice();
  old.forEach(function (p) {
    if (p.getDescription() === MSG_PROTECT_DESC) p.remove();
  });

  rows.forEach(function (row) {
    sh.getRange(row, 2).protect()
      .setDescription(MSG_PROTECT_DESC)
      .setWarningOnly(true);
  });
}

var MSG_PROTECT_DESC =
  '알림톡 사용 중에는 수정하지 마세요. 심사 통과한 템플릿과 글자가 다르면 발송이 거부됩니다.';

/**
 * 관리자 PIN 을 설정한다. 평문을 저장하지 않고 salt+SHA-256 해시만 남긴다.
 * Apps Script 편집기에서 직접 실행한다: setAdminPin('1234')
 */
function setAdminPin(pin) {
  var p = String(pin || '').trim();
  if (!/^\d{4,8}$/.test(p)) {
    throw new Error('PIN 은 숫자 4~8자리여야 합니다.');
  }
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty(SECRET_KEY.adminPinSalt);
  if (!salt) {
    salt = Utilities.getUuid();
    props.setProperty(SECRET_KEY.adminPinSalt, salt);
  }
  var sh = sheet_(APP_SHEET.설정);
  var rows = readRows_(sh, 2, 3);
  var hash = hashPin_(p, salt);
  for (var i = 0; i < rows.length; i++) {
    if (str_(rows[i][0]) === '관리자PIN해시') {
      sh.getRange(i + 2, 2).setValue(hash);
      clearSettingsCache_();
      return '관리자 PIN 이 설정되었습니다.';
    }
  }
  appendRows_(sh, [['관리자PIN해시', hash, SETTING_DEFAULTS.관리자PIN해시[1]]]);
  clearSettingsCache_();
  return '관리자 PIN 이 설정되었습니다.';
}

/** 발송 대행사 인증정보를 Script Properties 에 넣는다. 편집기에서 직접 실행한다. */
function setProviderSecrets(provider, keyOrApiKey, secretOrUserId) {
  var props = PropertiesService.getScriptProperties();
  if (provider === 'solapi') {
    props.setProperty(SECRET_KEY.solapiApiKey, String(keyOrApiKey));
    props.setProperty(SECRET_KEY.solapiApiSecret, String(secretOrUserId));
  } else if (provider === 'aligo') {
    props.setProperty(SECRET_KEY.aligoApiKey, String(keyOrApiKey));
    props.setProperty(SECRET_KEY.aligoUserId, String(secretOrUserId));
  } else {
    throw new Error('provider 는 solapi 또는 aligo 여야 합니다.');
  }
  return provider + ' 인증정보가 저장되었습니다.';
}
