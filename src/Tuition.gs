/**
 * Tuition.gs — 수강료(누적) 이월.
 *
 * 원래 이 일은 시판 템플릿에 딸려 온 매크로(copyScheduleToLog)가 했다.
 * clasp push 가 프로젝트를 로컬 src/ 와 똑같이 맞추면서 그 매크로가 지워졌고,
 * 그래서 9월 이월이 되지 않았다. 같은 일을 우리 코드로 다시 만든다.
 *
 * 하는 일은 하나다. 그달에 다니는 학생을 수강료(누적)에 한 줄씩 만든다.
 *
 * 이미 있는 학생 줄은 절대 건드리지 않는다. 결제일·교재비·비고는 손으로
 * 채우는 칸이라, 덮어쓰면 그달 수납 기록이 통째로 날아간다.
 */

/* ── 시트 좌표 ────────────────────────────────────────────────────── */

/** 헤더를 찾을 때 반드시 있어야 하는 이름들 */
var TUITION_REQUIRED = ['연도', '수강월', '이름', '과목', '비용'];

/** 우리가 채우는 칸. 나머지(교재비·비고·메모)는 사람이 손으로 넣는다. */
var TUITION_FILLED = [
  '연도', '수강월', '이름', '학부모성함', '과목',
  '수강일수', '수강료 결제일', '비용', '결제방법', '수강료+교재비'
];

/**
 * 시트에서 좌표를 실측한다.
 *
 * 열 번호를 코드에 박지 않는다. 템플릿 버전이 달라 열이 밀려도
 * 엉뚱한 칸에 돈 얘기를 쓰는 일이 없어야 한다.
 *
 * @return {{sheet, headerRow, firstDataRow, col: Object, baseYear: {r,c}, baseMonth: {r,c}}}
 */
function tuitionLayout_() {
  var sh = sheet_(SHEET.수강료누적, true);
  if (!sh) throw new Error('"' + SHEET.수강료누적 + '" 시트를 찾을 수 없습니다.');

  var scanRows = Math.min(12, sh.getLastRow());
  if (scanRows < 2) throw new Error('"' + SHEET.수강료누적 + '" 시트가 비어 있습니다.');

  var width = Math.max(sh.getLastColumn(), 20);
  var top = sh.getRange(1, 1, scanRows, width).getValues();

  // 1) 헤더 행 — 필요한 이름이 모두 있는 줄
  var headerRow = 0;
  var col = {};
  for (var r = 0; r < top.length; r++) {
    var found = {};
    for (var c = 0; c < top[r].length; c++) {
      var v = str_(top[r][c]);
      if (v) found[v] = c + 1;
    }
    var hasAll = TUITION_REQUIRED.every(function (k) { return !!found[k]; });
    if (hasAll) { headerRow = r + 1; col = found; break; }
  }
  if (!headerRow) {
    throw new Error(
      '"' + SHEET.수강료누적 + '" 에서 헤더 행을 찾지 못했습니다. ' +
      '(찾는 이름: ' + TUITION_REQUIRED.join(', ') + ')'
    );
  }

  // 2) 기준 연/월 — 라벨을 찾고 바로 아래 칸이 값이다
  function labelCell(label) {
    for (var r2 = 0; r2 < headerRow - 1; r2++) {
      for (var c2 = 0; c2 < top[r2].length; c2++) {
        if (str_(top[r2][c2]) === label) return { r: r2 + 2, c: c2 + 1 };
      }
    }
    return null;
  }

  return {
    sheet: sh,
    headerRow: headerRow,
    firstDataRow: headerRow + 1,
    col: col,
    baseYear: labelCell('기준 연도'),
    baseMonth: labelCell('기준 월')
  };
}

/** 시트에 적힌 기준 연/월. 없으면 이번 달. */
function tuitionBaseYm_(L) {
  var now = now_();
  var y = L.baseYear ? parseYear_(L.sheet.getRange(L.baseYear.r, L.baseYear.c).getValue()) : null;
  var m = L.baseMonth ? parseMonth_(L.sheet.getRange(L.baseMonth.r, L.baseMonth.c).getValue()) : null;
  return {
    year: y || now.getFullYear(),
    month: m || (now.getMonth() + 1),
    fromSheet: !!(y && m)
  };
}

/* ── 읽기 ─────────────────────────────────────────────────────────── */

/**
 * 이미 적힌 (연도, 월, 이름) 을 모은다.
 * 같은 사람을 두 번 만들지 않기 위한 열쇠다.
 */
function tuitionExistingKeys_(L) {
  var last = L.sheet.getLastRow();
  if (last < L.firstDataRow) return {};

  var n = last - L.firstDataRow + 1;
  var vals = L.sheet.getRange(L.firstDataRow, 1, n, L.sheet.getLastColumn()).getValues();

  var out = {};
  vals.forEach(function (row) {
    var y = parseYear_(row[L.col['연도'] - 1]);
    var m = parseMonth_(row[L.col['수강월'] - 1]);
    var name = str_(row[L.col['이름'] - 1]);
    if (y && m && name) out[y + '|' + m + '|' + name] = true;
  });
  return out;
}

/**
 * 수강생명단에서 돈에 관한 칸까지 읽는다.
 *
 * readActiveRoster_ 는 학원비·결제방법을 돌려주지 않아 여기서 직접 읽는다.
 * @return {Object} 이름+등록일 열쇠 -> {학원비, 결제방법, 수강일수, 보호자성함, 수강료납부일}
 */
function tuitionMoneyByKey_() {
  var sh = sheet_(SHEET.수강생명단);
  var rows = readRows_(sh, ROSTER_LAYOUT.firstDataRow);
  var C = ROSTER_LAYOUT.col;
  var out = {};

  rows.forEach(function (row) {
    var name = str_(cell_(row, C.이름));
    if (!name) return;
    var key = matchKey1_(name, toDate_(cell_(row, C.등록일)));
    out[key] = {
      학원비: cell_(row, C.학원비),
      결제방법: str_(cell_(row, C.결제방법)),
      수강일수: str_(cell_(row, C.수강일수)),
      보호자성함: str_(cell_(row, C.보호자성함)),
      수강료납부일: cell_(row, C.수강료납부일)
    };
  });
  return out;
}

/** '9월 1일' — 납부일이 비어 있으면 1일로 본다. */
function tuitionPayDay_(month, raw) {
  var day = 1;

  if (Object.prototype.toString.call(raw) === '[object Date]') {
    day = raw.getDate();
  } else {
    // 숫자를 toDate_ 에 넘기면 안 된다. new Date('5') 가 5월 1일이 되어
    // 엉뚱한 날짜가 나온다. 글자에서 숫자만 뽑아 쓴다.
    var m = String(raw === null || raw === undefined ? '' : raw).match(/(\d{1,2})/);
    if (m) {
      var n = Number(m[1]);
      if (n >= 1 && n <= 31) day = n;
    }
  }
  return month + '월 ' + day + '일';
}

/* ── 만들기 ───────────────────────────────────────────────────────── */

/**
 * 그달 수강료 줄을 만든다.
 *
 * 누구를 넣나:
 *   - 수강생명단에 있고 (퇴소생은 제외)
 *   - 그달 말일까지 등록했고
 *   - 휴원이 그달을 통째로 덮지 않는 학생
 *
 * 복수 과목(피아노+작곡)은 출석부와 달리 한 줄이다.
 * 수강료는 과목별로 나눠 받지 않고 합산 금액 한 건이기 때문이다.
 *
 * @return {{rows: Array, skipped: Array, warnings: Array}}
 */
function buildTuitionRows_(year, month) {
  var warnings = [];
  var merged = readMergedRoster_(warnings);
  var money = tuitionMoneyByKey_();
  var mStart = monthStart_(year, month);
  var mEnd = monthEnd_(year, month);

  var rows = [];
  var skipped = [];

  merged.forEach(function (rec) {
    var key = matchKey1_(rec.이름, rec.등록일);

    // 퇴소생은 넣지 않는다. 그달 중간에 그만둔 사람의 수강료는
    // 금액이 제각각이라 손으로 넣는 편이 낫다 — 대신 아래에 남겨 알린다.
    if (rec.상태 === ST.퇴소) {
      if (rec.퇴소일 && rec.퇴소일.getTime() >= mStart.getTime() &&
          rec.등록일 && rec.등록일.getTime() <= mEnd.getTime()) {
        skipped.push({ 이름: rec.이름, 사유: '퇴소 (' + fmtDate_(rec.퇴소일) + ')' });
      }
      return;
    }

    if (!rec.등록일 || rec.등록일.getTime() > mEnd.getTime()) return;

    if (leaveCoversRange_(rec.휴원구간, mStart, mEnd)) {
      skipped.push({ 이름: rec.이름, 사유: '휴원' });
      return;
    }

    var m = money[key] || {};
    rows.push({
      이름: rec.이름,
      학부모성함: m.보호자성함 || '',
      과목: rec.과목,
      수강일수: m.수강일수 || '',
      결제일: tuitionPayDay_(month, m.수강료납부일),
      비용: m.학원비,
      결제방법: m.결제방법 || ''
    });
  });

  return { rows: rows, skipped: skipped, warnings: warnings };
}

/* ── 실행 ─────────────────────────────────────────────────────────── */

/**
 * 수강료(누적) 를 그달 기준으로 채운다.
 *
 * @param {number=} year  없으면 시트의 기준 연도
 * @param {number=} month 없으면 시트의 기준 월
 * @param {boolean=} apply false 면 무엇이 들어갈지만 알려준다
 * @return {{added: number, report: string}}
 */
function syncTuition(year, month, apply) {
  applyProbedLayout_();

  return withLock_(function () {
    var L = tuitionLayout_();
    var base = tuitionBaseYm_(L);
    var y = year || base.year;
    var m = month || base.month;

    var built = buildTuitionRows_(y, m);
    var existing = tuitionExistingKeys_(L);

    var fresh = built.rows.filter(function (r) {
      return !existing[y + '|' + m + '|' + r.이름];
    });

    var lines = ['[수강료 이월] ' + y + '년 ' + m + '월'];
    if (!base.fromSheet && !year) {
      lines.push('  (시트의 기준 연/월을 읽지 못해 이번 달로 잡았습니다)');
    }
    lines.push('');
    lines.push('  대상 ' + built.rows.length + '명 · 이미 있음 ' +
      (built.rows.length - fresh.length) + '명 · 새로 넣을 것 ' + fresh.length + '명');

    if (built.skipped.length) {
      lines.push('');
      lines.push('  넣지 않은 학생 ' + built.skipped.length + '명');
      built.skipped.forEach(function (s) {
        lines.push('    · ' + s.이름 + ' — ' + s.사유);
      });
    }

    if (!fresh.length) {
      lines.push('');
      lines.push('  더 넣을 학생이 없습니다.');
      if (built.warnings.length) {
        lines.push('');
        built.warnings.forEach(function (w) { lines.push('  ! ' + w); });
      }
      return { added: 0, report: lines.join('\n') };
    }

    if (!apply) {
      lines.push('');
      lines.push('  [미리보기] 아직 쓰지 않았습니다. 아래가 들어갑니다.');
      fresh.slice(0, 10).forEach(function (r) {
        lines.push('    ' + r.이름 + ' · ' + r.과목 + ' · ' +
          (r.비용 === '' || r.비용 === null ? '금액없음' : r.비용) + ' · ' + r.결제일);
      });
      if (fresh.length > 10) lines.push('    … 그 밖에 ' + (fresh.length - 10) + '명');
      lines.push('');
      lines.push('  넣으려면 [수강료 이월 실행] 을 누르세요.');
      if (built.warnings.length) {
        lines.push('');
        built.warnings.forEach(function (w) { lines.push('  ! ' + w); });
      }
      return { added: 0, report: lines.join('\n') };
    }

    // 실제로 쓴다. 맨 아래에 이어 붙이고, 있던 줄은 손대지 않는다.
    var width = L.sheet.getLastColumn();
    var startRow = Math.max(L.sheet.getLastRow() + 1, L.firstDataRow);
    var C = L.col;

    var block = fresh.map(function (r, i) {
      var arr = [];
      for (var c = 0; c < width; c++) arr.push('');

      var put = function (name, v) {
        if (C[name]) arr[C[name] - 1] = v;
      };
      put('연도', y);
      put('수강월', m + '월');
      put('이름', r.이름);
      put('학부모성함', r.학부모성함);
      put('과목', r.과목);
      put('수강일수', r.수강일수);
      put('수강료 결제일', r.결제일);
      put('비용', r.비용);
      put('결제방법', r.결제방법);

      // 교재비를 나중에 손으로 넣으면 합계가 저절로 따라오도록 수식을 쓴다.
      // 값으로 박아 두면 교재비를 넣고도 합계를 또 고쳐야 한다.
      if (C['수강료+교재비'] && C['비용'] && C['교재비']) {
        var row = startRow + i;
        arr[C['수강료+교재비'] - 1] =
          '=N(' + colLetter_(C['비용']) + row + ')+N(' + colLetter_(C['교재비']) + row + ')';
      } else if (C['수강료+교재비']) {
        arr[C['수강료+교재비'] - 1] = r.비용;
      }
      return arr;
    });

    L.sheet.getRange(startRow, 1, block.length, width).setValues(block);

    lines.push('');
    lines.push('  ' + fresh.length + '명을 넣었습니다. (' + startRow + '행부터)');
    lines.push('  결제일·교재비·비고는 손으로 채우는 칸이라 비워 두었습니다.');
    if (built.warnings.length) {
      lines.push('');
      built.warnings.forEach(function (w) { lines.push('  ! ' + w); });
    }
    return { added: fresh.length, report: lines.join('\n') };
  }, 30000);
}

/** 열 번호를 A1 표기의 문자로. 27 -> AA */
function colLetter_(n) {
  var s = '';
  while (n > 0) {
    var r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ── 주기 실행 ────────────────────────────────────────────────────── */

/**
 * 이번 달 출석부에 빠진 학생이 있는지 본다.
 *
 * 매번 재생성하지 않는 이유가 있다. 재생성은 원장에서 값을 복원하는데,
 * 사람이 출석부에 직접 써넣은 △·X 는 원장에 없어서 지워진다.
 * 명단이 실제로 달라졌을 때만 다시 그린다.
 */
function attendbookNeedsRebuild_(year, month) {
  var expected = buildMonthRoster_(year, month).rows;
  var have = {};
  readLedgerRows_().forEach(function (r) {
    if (r.연도 === year && r.월 === month) have[r.이름 + '|' + r.과목명] = true;
  });

  for (var i = 0; i < expected.length; i++) {
    if (!have[expected[i].표시명 + '|' + expected[i].과목명]) return true;
  }
  return false;
}

/**
 * 한 시간마다 새 학생을 따라잡는다.
 *
 * 1일이 지나 들어온 학생은 그달 출석부에도 수강료(누적)에도 없다.
 * 다음 달까지 기다릴 수 없으니 주기적으로 메운다.
 */
function hourlyCatchUp() {
  applyProbedLayout_();
  var now = now_();
  var y = now.getFullYear();
  var m = now.getMonth() + 1;

  try {
    syncRoster();
  } catch (e) {
    Logger.log('명부 동기화 실패: ' + e.message);
  }

  try {
    if (attendbookNeedsRebuild_(y, m)) {
      Logger.log(rebuildAttendbook(y, m).report);
    }
  } catch (e) {
    Logger.log('출석부 확인 실패: ' + e.message);
  }

  try {
    var res = syncTuition(y, m, true);
    if (res.added) Logger.log(res.report);
  } catch (e) {
    Logger.log('수강료 이월 실패: ' + e.message);
  }
}
