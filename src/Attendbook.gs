/**
 * Attendbook.gs — 출석부 월별 동적 생성과 O 기입.
 *
 * ── 역할 분리 (이 파일의 전제) ───────────────────────────────────
 *
 *   출석부(누적) = 원장.  연도·수강월별로 모든 기록을 영구 보관한다.
 *   출석부       = 뷰.    선택된 연/월을 인쇄용으로 그린 것이며
 *                        언제든 원장에서 다시 그릴 수 있다.
 *
 * 등원을 기록하면 원장에 먼저 쓰고, 출석부가 마침 그 달을 보고 있을 때만
 * 화면에도 함께 찍는다. 이 순서 덕분에 재생성이 데이터를 잃지 않는다.
 */

/* ── 출석부가 지금 보고 있는 연/월 ────────────────────────────────── */

/**
 * 출석부의 연도/수강월 셀을 읽는다.
 * @return {{year: number, month: number}|null}
 */
function getBookYearMonth_() {
  var sh = sheet_(SHEET.출석부, true);
  if (!sh) return null;
  var year = parseYear_(sh.getRange(BOOK_LAYOUT.yearCell).getValue());
  var month = parseMonth_(sh.getRange(BOOK_LAYOUT.monthCell).getValue());
  if (!year || !month) return null;
  return { year: year, month: month };
}

/* ── 월별 재적 판정 ───────────────────────────────────────────────── */

/**
 * 해당 월에 출석부에 실려야 하는 학생인지 판정한다.
 *
 *   ① 등록일 ≤ 말일          — 등록 전이면 나오지 않는다
 *   ② 퇴소했다면 퇴소일 ≥ 초일 — 그 달에 하루라도 다녔어야 한다
 *   ③ 휴원 구간이 그 달을 통째로 덮지 않을 것
 *
 * ③ 은 상태와 무관하게 적용한다. 휴원생명단은 이력 시트라
 * 지금 재원인 학생도 과거에 휴원한 달이 있을 수 있고,
 * 그 달 출석부에는 나오지 않아야 하기 때문이다.
 * 월 중간에 휴원했다면 일부라도 나왔으므로 포함한다.
 *
 * @param {Object} rec readMergedRoster_() 의 한 항목
 * @param {Date} mStart 월 초일
 * @param {Date} mEnd 월 말일
 */
function enrolledInMonth_(rec, mStart, mEnd) {
  if (!rec.등록일) return false;
  if (rec.등록일.getTime() > mEnd.getTime()) return false;

  if (rec.상태 === ST.퇴소) {
    if (!rec.퇴소일) return false;
    if (rec.퇴소일.getTime() < mStart.getTime()) return false;
  }

  return !leaveCoversRange_(rec.휴원구간, mStart, mEnd);
}

/**
 * 해당 월의 출석부 행 목록을 만든다.
 * 복수 과목은 '+' 로 나눠 그만큼 행을 복제한다.
 *
 * @return {{rows: Array, warnings: string[]}}
 *   rows: [{이름, 표시명, 과목명, 상태, 학생ID}]
 */
function buildMonthRoster_(year, month) {
  var warnings = [];
  var merged = readMergedRoster_(warnings);
  var mStart = monthStart_(year, month);
  var mEnd = monthEnd_(year, month);

  // 표시명(동명이인 접미사)은 _출결_학생 이 소유한다.
  var students = readStudents_();
  var displayByKey = {};
  var idByKey = {};
  students.forEach(function (s) {
    var k = matchKey1_(s.이름, s.등록일);
    displayByKey[k] = s.표시명 || s.이름;
    idByKey[k] = s.학생ID;
  });

  var rows = [];
  merged.forEach(function (rec) {
    if (!enrolledInMonth_(rec, mStart, mEnd)) return;
    var key = matchKey1_(rec.이름, rec.등록일);
    var display = displayByKey[key] || rec.이름;

    splitSubjects_(rec.과목).forEach(function (subject) {
      rows.push({
        이름: rec.이름,
        표시명: display,
        과목명: subject,
        상태: rec.상태,
        학생ID: idByKey[key] || ''
      });
    });
  });

  return { rows: rows, warnings: warnings };
}

/* ── 원장(출석부 누적) 읽기·쓰기 ──────────────────────────────────── */

/**
 * 원장 전체를 파싱한다.
 * @return {Array<{연도, 월, 번호, 이름, 과목명, 수강요일, days: Object, extra}>}
 *   days 는 {일자: 값} 이며 값이 있는 칸만 담는다.
 */
function readLedgerRows_() {
  var sh = sheet_(SHEET.출석부누적);
  var width = LEDGER_LAYOUT.특이사항Col;
  var raw = readRows_(sh, LEDGER_LAYOUT.firstDataRow, width);
  var out = [];

  raw.forEach(function (row) {
    var year = parseYear_(cell_(row, LEDGER_LAYOUT.col.연도));
    var name = str_(cell_(row, LEDGER_LAYOUT.col.이름));
    if (!year && !name) return;

    var days = {};
    for (var d = 1; d <= 31; d++) {
      var v = str_(cell_(row, LEDGER_LAYOUT.day1Col + d - 1));
      if (v) days[d] = v;
    }
    out.push({
      연도: year,
      월: parseMonth_(cell_(row, LEDGER_LAYOUT.col.수강월)),
      번호: toNumber_(cell_(row, LEDGER_LAYOUT.col.번호)),
      이름: name,
      과목명: str_(cell_(row, LEDGER_LAYOUT.col.과목명)),
      수강요일: str_(cell_(row, LEDGER_LAYOUT.col.수강요일)),
      days: days,
      특이사항: str_(cell_(row, LEDGER_LAYOUT.특이사항Col))
    });
  });
  return out;
}

/** 원장 한 건을 시트 배열로 편다. */
function ledgerRowToArray_(r) {
  var width = LEDGER_LAYOUT.특이사항Col;
  var arr = [];
  for (var i = 0; i < width; i++) arr.push('');
  arr[LEDGER_LAYOUT.col.연도 - 1] = r.연도;
  arr[LEDGER_LAYOUT.col.수강월 - 1] = r.월 + '월';
  arr[LEDGER_LAYOUT.col.번호 - 1] = r.번호;
  arr[LEDGER_LAYOUT.col.이름 - 1] = r.이름;
  arr[LEDGER_LAYOUT.col.과목명 - 1] = r.과목명;
  arr[LEDGER_LAYOUT.col.수강요일 - 1] = r.수강요일 || '';
  Object.keys(r.days).forEach(function (d) {
    arr[LEDGER_LAYOUT.day1Col + Number(d) - 2] = r.days[d];
  });
  arr[LEDGER_LAYOUT.특이사항Col - 1] = r.특이사항 || '';
  return arr;
}

/**
 * 같은 (연도, 월, 이름, 과목명) 행을 하나로 합친다.
 *
 * 이 조합은 원래 한 행뿐이어야 한다. 두 행이 있다면 중복이므로
 * 출결 기호를 합쳐서 한 행으로 만든다. 먼저 나온 값이 이긴다.
 *
 * 중복이 남아 있으면 재생성 때마다 짝을 못 찾은 행이 "미복원" 으로
 * 계속 따라붙어 행 수가 불어난다. 여기서 원천 차단한다.
 *
 * @return {{rows: Array, merged: number}}
 */
function dedupeLedgerRows_(rows) {
  var byKey = {};
  var order = [];
  var merged = 0;

  rows.forEach(function (r) {
    var key = [r.연도, r.월, r.이름, r.과목명].join('|');
    if (!byKey[key]) {
      byKey[key] = r;
      order.push(key);
      return;
    }
    var kept = byKey[key];
    Object.keys(r.days).forEach(function (d) {
      if (!kept.days[d]) kept.days[d] = r.days[d];
    });
    if (!kept.수강요일) kept.수강요일 = r.수강요일;
    if (!kept.특이사항) kept.특이사항 = r.특이사항;
    merged++;
  });

  return { rows: order.map(function (k) { return byKey[k]; }), merged: merged };
}

/**
 * 원장 전체를 다시 쓴다. 연도·월·번호 순으로 정렬해 결과를 결정적으로 만든다.
 * 쓰기 직전에 항상 중복을 합친다.
 */
function writeLedgerRows_(rows) {
  var sh = sheet_(SHEET.출석부누적);
  var deduped = dedupeLedgerRows_(rows);
  var sorted = deduped.rows.slice().sort(function (a, b) {
    if ((a.연도 || 0) !== (b.연도 || 0)) return (a.연도 || 0) - (b.연도 || 0);
    if ((a.월 || 0) !== (b.월 || 0)) return (a.월 || 0) - (b.월 || 0);
    return (a.번호 || 0) - (b.번호 || 0);
  });

  clearBelow_(sh, LEDGER_LAYOUT.firstDataRow);
  if (!sorted.length) return;

  var arrays = sorted.map(ledgerRowToArray_);
  sh.getRange(LEDGER_LAYOUT.firstDataRow, 1, arrays.length, LEDGER_LAYOUT.특이사항Col)
    .setValues(arrays);
}

/* ── 기존 표기 마이그레이션 (김철수 P → 김철수 / 피아노) ──────────── */

/**
 * 원장의 옛 표기를 정리한다.
 *
 * 출석부는 2과목 학생을 '김철수 P' / '김철수 C' 처럼 이름 뒤 영문 한 글자로
 * 나눠 왔다. 이건 과목 구분이므로 비어 있는 과목명 열로 옮긴다.
 * 그러면 이름 열에는 동명이인 접미사 규칙 하나만 남는다.
 *
 * 어떤 글자가 어떤 과목인지는 정해진 규칙이 없으므로(P=피아노, C=작곡 추정)
 * 같은 이름 안에서의 등장 순서를 학생의 과목 순서와 짝짓는다.
 * 무엇을 어떻게 바꿨는지는 전부 리포트로 남긴다.
 *
 * @return {{changed: number, report: string[]}}
 */
function migrateLedgerNames_(ledgerRows, subjectsByName) {
  var report = [];
  var changed = 0;
  var seen = {};   // (연도|월|기본이름) → 지금까지 본 개수

  ledgerRows.forEach(function (r) {
    var m = String(r.이름).match(/^(.+?)\s+([A-Za-z])$/);
    if (!m) return;

    var base = m[1].trim();
    var letter = m[2];
    var key = r.연도 + '|' + r.월 + '|' + base;
    var idx = seen[key] || 0;
    seen[key] = idx + 1;

    var subjects = subjectsByName[base] || [];
    var subject = subjects[idx] || (letter + '과목');

    report.push(
      r.연도 + '년 ' + r.월 + '월: "' + r.이름 + '" → 이름 "' + base +
      '", 과목명 "' + subject + '"'
    );
    r.이름 = base;
    if (!r.과목명) r.과목명 = subject;
    changed++;
  });

  return { changed: changed, report: report };
}

/* ── 재생성 ───────────────────────────────────────────────────────── */

/**
 * 해당 월의 출석부를 명단 3종에서 다시 그린다.
 *
 * 원장(누적)은 지우지 않는다. 새 명단에 없는 옛 기록도 그대로 보존하고
 * 미복원 항목으로 이력에 남긴다.
 *
 * @param {number=} year 생략하면 출석부가 보고 있는 연/월
 * @param {number=} month
 * @return {{report: string, rows: number, restored: number, warnings: string[]}}
 */
function rebuildAttendbook(year, month) {
  applyProbedLayout_();

  return withLock_(function () {
    if (!year || !month) {
      var ym = getBookYearMonth_();
      if (!ym) throw new Error('출석부의 연도/수강월 셀을 읽을 수 없습니다.');
      year = ym.year;
      month = ym.month;
    }

    var built = buildMonthRoster_(year, month);
    var newRows = built.rows;
    var warnings = built.warnings;

    // 마이그레이션에 쓸 "이름 → 과목 토큰 목록"
    var subjectsByName = {};
    readMergedRoster_([]).forEach(function (rec) {
      subjectsByName[rec.이름] = splitSubjects_(rec.과목);
    });

    var ledger = readLedgerRows_();
    var migration = migrateLedgerNames_(ledger, subjectsByName);
    if (migration.changed) {
      warnings.push('원장의 옛 표기 ' + migration.changed + '건을 과목명 열로 옮겼습니다.');
      migration.report.forEach(function (line) { warnings.push('  ' + line); });
    }

    // 이번 달 원장 블록을 색인한다 (이름 → 후보 목록)
    var monthRows = ledger.filter(function (r) { return r.연도 === year && r.월 === month; });
    var otherRows = ledger.filter(function (r) { return !(r.연도 === year && r.월 === month); });

    var byName = {};
    monthRows.forEach(function (r) {
      (byName[r.이름] = byName[r.이름] || []).push(r);
    });
    var consumed = [];

    /** 새 행에 대응하는 옛 원장 행을 찾는다. 과목명 우선, 없으면 순서대로. */
    function takeLedgerRow(displayName, subject) {
      var pool = byName[displayName];
      if (!pool || !pool.length) return null;

      for (var i = 0; i < pool.length; i++) {
        if (pool[i].__used) continue;
        if (pool[i].과목명 && pool[i].과목명 === subject) {
          pool[i].__used = true;
          consumed.push(pool[i]);
          return pool[i];
        }
      }
      for (var j = 0; j < pool.length; j++) {
        if (!pool[j].__used) {
          pool[j].__used = true;
          consumed.push(pool[j]);
          return pool[j];
        }
      }
      return null;
    }

    // 새 원장 블록을 만든다 (값은 옛 원장에서 복원)
    var restored = 0;
    var rebuiltBlock = newRows.map(function (r, i) {
      var old = takeLedgerRow(r.표시명, r.과목명);
      var days = old ? old.days : {};
      if (old && Object.keys(days).length) restored++;
      return {
        연도: year,
        월: month,
        번호: i + 1,
        이름: r.표시명,
        과목명: r.과목명,
        수강요일: old ? old.수강요일 : '',
        days: days,
        특이사항: old ? old.특이사항 : ''
      };
    });

    // 짝을 못 찾고 남은 옛 기록을 처리한다.
    //
    // 이름이 새 명단에 있으면 중복 행이므로 같은 학생의 새 행에 기호를 합친다.
    // 그냥 뒤에 붙이면 재생성할 때마다 따라다니며 행이 계속 불어난다.
    // 이름 자체가 명단에 없을 때만 진짜 미복원으로 보존한다.
    var byNewName = {};
    rebuiltBlock.forEach(function (row, i) {
      (byNewName[row.이름] = byNewName[row.이름] || []).push(i);
    });

    var leftovers = monthRows.filter(function (r) {
      return !r.__used && Object.keys(r.days).length > 0;
    });
    var mergedRows = 0;
    var mergedMarks = 0;
    var orphans = [];

    leftovers.forEach(function (r) {
      var targets = byNewName[r.이름];
      if (!targets || !targets.length) { orphans.push(r); return; }

      var pick = targets[0];
      for (var t = 0; t < targets.length; t++) {
        if (rebuiltBlock[targets[t]].과목명 === r.과목명) { pick = targets[t]; break; }
      }
      var dst = rebuiltBlock[pick].days;
      Object.keys(r.days).forEach(function (d) {
        if (!dst[d]) { dst[d] = r.days[d]; mergedMarks++; }
      });
      r.__used = true;
      mergedRows++;
    });

    if (mergedRows) {
      warnings.push(
        '원장에 중복된 행 ' + mergedRows + '개를 같은 학생의 행에 합쳤습니다' +
        (mergedMarks ? ' (기호 ' + mergedMarks + '칸 회수)' : '') + '.'
      );
    }

    orphans.forEach(function (r, i) {
      r.번호 = rebuiltBlock.length + i + 1;
      rebuiltBlock.push(r);
      appendHistory_({
        대상기록ID: year + '-' + month,
        작업: '출석부재생성',
        필드: '미복원',
        이전값: r.이름 + (r.과목명 ? ' / ' + r.과목명 : ''),
        이후값: '(명단에 없어 블록 끝으로 이동)',
        수행자: '시스템',
        사유: '재생성 대상 명단에 해당 학생이 없습니다'
      });
      warnings.push(
        '원장에 "' + r.이름 + '" 기록이 있으나 ' + year + '년 ' + month +
        '월 명단에 없습니다. 지우지 않고 보존했습니다.'
      );
    });

    writeLedgerRows_(otherRows.concat(rebuiltBlock));

    // 출석부(뷰)를 다시 그린다
    var bookRows = paintBook_(year, month, rebuiltBlock);

    // _출결_학생 의 출석부행을 갱신한다
    updateBookRowMapping_(rebuiltBlock, bookRows.firstRow);

    var lines = [
      '[출석부 재생성] ' + year + '년 ' + month + '월',
      '  행 ' + rebuiltBlock.length + '개 (학생 ' + newRows.length + '행 + 보존 ' + orphans.length + '행)',
      '  원장에서 값 복원 ' + restored + '행'
    ];
    if (warnings.length) {
      lines.push('');
      lines.push('[확인 필요]');
      warnings.forEach(function (w) { lines.push('  · ' + w); });
    }

    clearRosterCache_();
    return {
      report: lines.join('\n'),
      rows: rebuiltBlock.length,
      restored: restored,
      warnings: warnings
    };
  }, 60000);
}

/**
 * 출석부(뷰)에 블록을 그린다.
 *
 * 날짜·요일 헤더는 템플릿이 수식으로 자동 계산하므로 건드리지 않는다.
 * 수식이 없을 때만 값으로 채운다.
 *
 * @return {{firstRow: number, count: number}}
 */
function paintBook_(year, month, block) {
  var sh = sheet_(SHEET.출석부);
  var first = BOOK_LAYOUT.firstDataRow;
  var width = BOOK_LAYOUT.특이사항Col;
  var lastDay = lastDayOfMonth_(year, month);

  writeBookHeadersIfPlain_(sh, year, month, lastDay);
  clearBelow_(sh, first);

  if (!block.length) return { firstRow: first, count: 0 };

  var arrays = block.map(function (r, i) {
    var arr = [];
    for (var c = 0; c < width; c++) arr.push('');
    arr[BOOK_LAYOUT.col.번호 - 1] = i + 1;
    arr[BOOK_LAYOUT.col.이름 - 1] = r.이름;
    arr[BOOK_LAYOUT.col.과목명 - 1] = r.과목명;
    arr[BOOK_LAYOUT.col.수강요일 - 1] = r.수강요일 || '';
    Object.keys(r.days).forEach(function (d) {
      var day = Number(d);
      if (day >= 1 && day <= lastDay) {
        arr[BOOK_LAYOUT.day1Col + day - 2] = r.days[d];
      }
    });
    arr[BOOK_LAYOUT.특이사항Col - 1] = r.특이사항 || '';
    return arr;
  });

  sh.getRange(first, 1, arrays.length, width).setValues(arrays);
  return { firstRow: first, count: arrays.length };
}

/**
 * 날짜·요일 헤더가 수식이면 그대로 두고, 값이면 다시 계산해 넣는다.
 *
 * 템플릿 설명서에 "연/월 설정에 따라 날짜/요일이 자동 입력"이라고 되어 있어
 * 보통은 수식이다. 수식을 값으로 덮으면 다음 달에 갱신이 멈추므로
 * 반드시 확인하고 건너뛴다.
 */
function writeBookHeadersIfPlain_(sh, year, month, lastDay) {
  var dayRange = sh.getRange(BOOK_LAYOUT.headerRow, BOOK_LAYOUT.day1Col, 1, 31);
  var formulas = dayRange.getFormulas()[0];
  var hasFormula = formulas.some(function (f) { return f && f.charAt(0) === '='; });
  if (hasFormula) return false;

  var days = [];
  var weekdays = [];
  for (var d = 1; d <= 31; d++) {
    if (d <= lastDay) {
      days.push(d);
      weekdays.push(weekdayKo_(year, month, d));
    } else {
      days.push('');
      weekdays.push('');
    }
  }
  dayRange.setValues([days]);

  if (BOOK_LAYOUT.weekdayRow >= 1) {
    var wRange = sh.getRange(BOOK_LAYOUT.weekdayRow, BOOK_LAYOUT.day1Col, 1, 31);
    var wf = wRange.getFormulas()[0];
    if (!wf.some(function (f) { return f && f.charAt(0) === '='; })) {
      wRange.setValues([weekdays]);
    }
  }
  return true;
}

/**
 * _출결_학생 의 출석부행 열을 갱신한다.
 * 복수 과목 학생은 '9,10' 처럼 여러 행을 갖는다.
 */
function updateBookRowMapping_(block, firstRow) {
  var students = readStudents_();
  var rowsByDisplay = {};
  block.forEach(function (r, i) {
    (rowsByDisplay[r.이름] = rowsByDisplay[r.이름] || []).push(firstRow + i);
  });

  var sh = sheet_(APP_SHEET.학생, true);
  if (!sh || !students.length) return;

  var values = students.map(function (s) {
    var display = s.표시명 || s.이름;
    var rows = rowsByDisplay[display];
    return [rows ? rows.join(',') : ''];
  });
  sh.getRange(2, STUDENT_COL.출석부행, values.length, 1).setValues(values);
}

/* ── O 기입 ───────────────────────────────────────────────────────── */

/**
 * 출결 기호를 원장과 (해당 월을 보고 있으면) 출석부에 찍는다.
 *
 * 이미 값이 있으면(수동 △/X 포함) 덮어쓰지 않는다.
 *
 * @param {string} displayName 표시명
 * @param {Date} date 출결 날짜
 * @param {string} mark 보통 'O'
 * @param {string[]=} subjects 고른 과목. 비우면 그 학생의 모든 행에 찍는다.
 * @return {{ledger, book, rowFound, alreadyMarked, skipped}}
 *   ledger/book  실제로 찍은 칸 수
 *   rowFound     그 달 원장에 해당 학생 행이 있었는지
 *   alreadyMarked 행은 있는데 이미 값이 있어 건드리지 않은 경우 (정상)
 *   skipped      사람이 알아야 할 사유만 담는다. 정상이면 빈 문자열
 */
function markAttendance_(displayName, date, mark, subjects) {
  var year = date.getFullYear();
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var symbol = mark || MARK.출석;
  var wanted = normalizeSubjectFilter_(subjects);

  var result = { ledger: 0, book: 0, rowFound: 0, alreadyMarked: false, skipped: '' };

  // 1) 원장에 먼저 쓴다
  var sh = sheet_(SHEET.출석부누적);
  var raw = readRows_(sh, LEDGER_LAYOUT.firstDataRow, LEDGER_LAYOUT.특이사항Col);
  var dayCol = LEDGER_LAYOUT.day1Col + day - 1;

  raw.forEach(function (row, i) {
    if (parseYear_(cell_(row, LEDGER_LAYOUT.col.연도)) !== year) return;
    if (parseMonth_(cell_(row, LEDGER_LAYOUT.col.수강월)) !== month) return;
    if (str_(cell_(row, LEDGER_LAYOUT.col.이름)) !== displayName) return;
    if (!subjectMatches_(wanted, cell_(row, LEDGER_LAYOUT.col.과목명))) return;

    result.rowFound++;
    if (str_(cell_(row, dayCol))) {           // 수동 △/X 포함, 덮어쓰기 금지
      result.alreadyMarked = true;
      return;
    }
    sh.getRange(LEDGER_LAYOUT.firstDataRow + i, dayCol).setValue(symbol);
    result.ledger++;
  });

  // 행 자체가 없는 것만 문제다. 이미 값이 있는 건 정상(재입력·수동 표기)이다.
  if (result.rowFound === 0) {
    result.skipped = '원장 ' + year + '년 ' + month + '월에 "' + displayName +
      '" 행이 없습니다. 출석부 재생성이 필요합니다.';
    return result;
  }

  // 2) 출석부가 같은 달을 보고 있을 때만 화면에도 찍는다
  var ym = getBookYearMonth_();
  if (!ym || ym.year !== year || ym.month !== month) {
    result.skipped = '출석부가 ' +
      (ym ? ym.year + '년 ' + ym.month + '월' : '다른 기간') +
      '을 보고 있어 화면 기입은 건너뛰었습니다. 원장에는 기록되었습니다.';
    return result;
  }

  var bookSh = sheet_(SHEET.출석부);
  var bookRaw = readRows_(bookSh, BOOK_LAYOUT.firstDataRow, BOOK_LAYOUT.특이사항Col);
  var bookDayCol = BOOK_LAYOUT.day1Col + day - 1;

  bookRaw.forEach(function (row, i) {
    if (str_(cell_(row, BOOK_LAYOUT.col.이름)) !== displayName) return;
    if (!subjectMatches_(wanted, cell_(row, BOOK_LAYOUT.col.과목명))) return;
    if (str_(cell_(row, bookDayCol))) return;
    bookSh.getRange(BOOK_LAYOUT.firstDataRow + i, bookDayCol).setValue(symbol);
    result.book++;
  });

  return result;
}

/**
 * 출결 기호를 지운다. 관리자가 기록을 취소할 때 쓴다.
 * 우리가 찍은 기호와 같을 때만 지운다 (수동 △/X 는 보존).
 */
function unmarkAttendance_(displayName, date, mark, subjects) {
  var year = date.getFullYear();
  var month = date.getMonth() + 1;
  var day = date.getDate();
  var symbol = mark || MARK.출석;
  var wanted = normalizeSubjectFilter_(subjects);
  var result = { ledger: 0, book: 0 };

  var sh = sheet_(SHEET.출석부누적);
  var raw = readRows_(sh, LEDGER_LAYOUT.firstDataRow, LEDGER_LAYOUT.특이사항Col);
  var dayCol = LEDGER_LAYOUT.day1Col + day - 1;

  raw.forEach(function (row, i) {
    if (parseYear_(cell_(row, LEDGER_LAYOUT.col.연도)) !== year) return;
    if (parseMonth_(cell_(row, LEDGER_LAYOUT.col.수강월)) !== month) return;
    if (str_(cell_(row, LEDGER_LAYOUT.col.이름)) !== displayName) return;
    if (!subjectMatches_(wanted, cell_(row, LEDGER_LAYOUT.col.과목명))) return;
    if (str_(cell_(row, dayCol)) !== symbol) return;
    sh.getRange(LEDGER_LAYOUT.firstDataRow + i, dayCol).setValue('');
    result.ledger++;
  });

  var ym = getBookYearMonth_();
  if (ym && ym.year === year && ym.month === month) {
    var bookSh = sheet_(SHEET.출석부);
    var bookRaw = readRows_(bookSh, BOOK_LAYOUT.firstDataRow, BOOK_LAYOUT.특이사항Col);
    var bookDayCol = BOOK_LAYOUT.day1Col + day - 1;
    bookRaw.forEach(function (row, i) {
      if (str_(cell_(row, BOOK_LAYOUT.col.이름)) !== displayName) return;
      if (!subjectMatches_(wanted, cell_(row, BOOK_LAYOUT.col.과목명))) return;
      if (str_(cell_(row, bookDayCol)) !== symbol) return;
      bookSh.getRange(BOOK_LAYOUT.firstDataRow + i, bookDayCol).setValue('');
      result.book++;
    });
  }

  return result;
}

/**
 * 과목 필터를 정리한다.
 * 빈 배열이면 "전부" 를 뜻한다 (단일 과목 학생, 또는 과목을 안 고른 경우).
 */
function normalizeSubjectFilter_(subjects) {
  if (!subjects) return [];
  var list = Array.isArray(subjects) ? subjects : String(subjects).split(',');
  return list.map(function (s) { return str_(s); }).filter(function (s) { return !!s; });
}

/** 이 행의 과목명이 고른 과목에 드는지. 필터가 비어 있으면 전부 통과. */
function subjectMatches_(wanted, cellValue) {
  if (!wanted.length) return true;
  return wanted.indexOf(str_(cellValue)) !== -1;
}

/* ── 정합성 점검 ──────────────────────────────────────────────────── */

/**
 * 명단 · 출석부 · _출결_학생 을 대조해 어긋난 곳을 찾는다.
 * @return {string} 리포트
 */
function checkConsistency() {
  applyProbedLayout_();

  var ym = getBookYearMonth_();
  if (!ym) return '출석부의 연도/수강월을 읽을 수 없습니다.';

  var built = buildMonthRoster_(ym.year, ym.month);
  var expected = {};
  built.rows.forEach(function (r) {
    expected[r.표시명] = (expected[r.표시명] || 0) + 1;
  });

  var sh = sheet_(SHEET.출석부);
  var actual = {};
  readRows_(sh, BOOK_LAYOUT.firstDataRow, BOOK_LAYOUT.특이사항Col).forEach(function (row) {
    var n = str_(cell_(row, BOOK_LAYOUT.col.이름));
    if (n) actual[n] = (actual[n] || 0) + 1;
  });

  var missing = [];
  var extra = [];
  Object.keys(expected).forEach(function (n) {
    if ((actual[n] || 0) < expected[n]) missing.push(n + ' (' + expected[n] + '행 필요, ' + (actual[n] || 0) + '행)');
  });
  Object.keys(actual).forEach(function (n) {
    if (!expected[n]) extra.push(n);
  });

  var students = readStudents_();
  var noPhone = students.filter(function (s) { return s.상태 === ST.재원 && !s.보호자연락처; });
  var noBookRow = students.filter(function (s) { return s.상태 === ST.재원 && !s.출석부행; });

  var lines = [
    '[정합성 점검] ' + ym.year + '년 ' + ym.month + '월',
    '  명단 기준 필요 행: ' + built.rows.length,
    '  출석부 실제 행: ' + Object.keys(actual).reduce(function (a, k) { return a + actual[k]; }, 0),
    '  연락처 미등록(재원): ' + noPhone.length + '명',
    '  출석부행 미매핑(재원): ' + noBookRow.length + '명'
  ];
  if (missing.length) {
    lines.push('  출석부에 없는 학생: ' + missing.join(', '));
  }
  if (extra.length) {
    lines.push('  명단에 없는 출석부 행: ' + extra.join(', '));
  }
  if (built.warnings.length) {
    lines.push('');
    lines.push('[명단 경고]');
    built.warnings.forEach(function (w) { lines.push('  · ' + w); });
  }
  if (!missing.length && !extra.length) {
    lines.push('  → 출석부와 명단이 일치합니다.');
  }
  return lines.join('\n');
}
