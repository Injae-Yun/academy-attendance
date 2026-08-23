/**
 * Expense.gs — 연도별 지출 입력.
 *
 * 지출은 자동화가 불가능한 수기 항목인데, 연도가 바뀔 때 새 값을 넣을
 * 수단이 없었다. 수입/지출 시트의 표는 전부 SUMIFS 수식이라 직접 쓸 수 없고,
 * 실제 데이터가 들어가는 '지출내역 원장' 은 설명서에도 없어 존재를 알기 어렵다.
 *
 * 여기서는 세 가지를 한다.
 *   1) 원장의 월 표기를 통일하고 완전 중복 행을 제거한다 (선행 정리)
 *   2) _지출_입력 시트에 '항목 × 12개월' 격자를 만든다
 *   3) 격자를 원장에 upsert 한다 (중복이 다시 쌓이지 않는다)
 */

/* ── 원장 읽기/쓰기 ───────────────────────────────────────────────── */

/**
 * 지출내역 원장을 읽는다.
 * @return {Array<{연도, 월원문, 월, 예산구분, 사업항목, 금액, 비고, 행}>}
 */
function readExpenseRows_() {
  var sh = sheet_(SHEET.지출원장);
  var raw = readRows_(sh, EXPENSE_LAYOUT.firstDataRow, EXPENSE_LAYOUT.col.비고);
  var out = [];
  raw.forEach(function (row, i) {
    var year = parseYear_(cell_(row, EXPENSE_LAYOUT.col.연도));
    var item = str_(cell_(row, EXPENSE_LAYOUT.col.사업항목));
    if (!year && !item) return;
    out.push({
      연도: year,
      월원문: cell_(row, EXPENSE_LAYOUT.col.월),
      월: parseMonth_(cell_(row, EXPENSE_LAYOUT.col.월)),
      예산구분: str_(cell_(row, EXPENSE_LAYOUT.col.예산구분)),
      사업항목: item,
      금액: toNumber_(cell_(row, EXPENSE_LAYOUT.col.금액)),
      비고: str_(cell_(row, EXPENSE_LAYOUT.col.비고)),
      행: EXPENSE_LAYOUT.firstDataRow + i
    });
  });
  return out;
}

/** 원장 전체를 다시 쓴다. 연도·월·예산구분·사업항목 순으로 정렬한다. */
function writeExpenseRows_(rows, monthStyle) {
  var sh = sheet_(SHEET.지출원장);
  var sorted = rows.slice().sort(function (a, b) {
    if ((a.연도 || 0) !== (b.연도 || 0)) return (a.연도 || 0) - (b.연도 || 0);
    if ((a.월 || 0) !== (b.월 || 0)) return (a.월 || 0) - (b.월 || 0);
    if (a.예산구분 !== b.예산구분) return a.예산구분 < b.예산구분 ? -1 : 1;
    return a.사업항목 < b.사업항목 ? -1 : 1;
  });

  clearBelow_(sh, EXPENSE_LAYOUT.firstDataRow);
  if (!sorted.length) return;

  var arrays = sorted.map(function (r) {
    var arr = [];
    for (var i = 0; i < EXPENSE_LAYOUT.col.비고; i++) arr.push('');
    arr[EXPENSE_LAYOUT.col.연도 - 1] = r.연도;
    arr[EXPENSE_LAYOUT.col.월 - 1] = formatExpenseMonth_(r.월, monthStyle);
    arr[EXPENSE_LAYOUT.col.예산구분 - 1] = r.예산구분;
    arr[EXPENSE_LAYOUT.col.사업항목 - 1] = r.사업항목;
    arr[EXPENSE_LAYOUT.col.금액 - 1] = r.금액;
    arr[EXPENSE_LAYOUT.col.비고 - 1] = r.비고 || '';
    return arr;
  });
  sh.getRange(EXPENSE_LAYOUT.firstDataRow, 1, arrays.length, EXPENSE_LAYOUT.col.비고)
    .setValues(arrays);
}

/** 월 숫자를 시트 표기로 바꾼다. 'ko' → '1월', 'num' → 1 */
function formatExpenseMonth_(month, style) {
  if (!month) return '';
  return style === 'num' ? month : month + '월';
}

/* ── 월 표기 형식 판별 ────────────────────────────────────────────── */

/**
 * 원장의 월 표기를 어느 형식으로 맞춰야 하는지 알아낸다.
 *
 * 수입/지출 시트의 SUMIFS 는 월 조건으로 표의 월 헤더 셀을 참조한다.
 * 그 헤더가 '1월' 이면 원장도 '1월' 이어야 값이 잡힌다.
 * 그래서 헤더 형식을 그대로 따른다.
 *
 * @return {{style: string, evidence: string}}
 */
function detectExpenseMonthFormat_() {
  var sh = sheet_(SHEET.수입지출, true);
  if (!sh) {
    return { style: 'ko', evidence: '수입/지출 시트를 찾지 못해 기본값(1월 형식)을 씁니다.' };
  }

  var maxRow = Math.min(sh.getLastRow(), 80);
  var maxCol = Math.min(sh.getLastColumn(), 20);
  var values = sh.getRange(1, 1, maxRow, maxCol).getValues();

  for (var r = 0; r < values.length; r++) {
    var hasJan = false, hasDec = false, koStyle = false, numStyle = false;
    for (var c = 0; c < values[r].length; c++) {
      var v = values[r][c];
      var s = str_(v);
      if (s === '1월') { hasJan = true; koStyle = true; }
      if (s === '12월') { hasDec = true; koStyle = true; }
      if (v === 1 || s === '1') { hasJan = true; numStyle = true; }
      if (v === 12 || s === '12') { hasDec = true; numStyle = true; }
    }
    if (hasJan && hasDec) {
      return {
        style: koStyle ? 'ko' : (numStyle ? 'num' : 'ko'),
        evidence: '수입/지출 ' + (r + 1) + '행의 월 헤더가 ' +
          (koStyle ? '"1월" 형식' : '숫자 형식') + '입니다.'
      };
    }
  }
  return { style: 'ko', evidence: '월 헤더를 찾지 못해 기본값(1월 형식)을 씁니다.' };
}

/* ── 선행 정리: 중복 제거 + 표기 통일 ─────────────────────────────── */

/**
 * 원장 상태를 점검한다. 아무것도 바꾸지 않는다.
 * @return {string} 리포트
 */
function analyzeExpenseLedger() {
  applyProbedLayout_();

  var rows = readExpenseRows_();
  var fmt = detectExpenseMonthFormat_();

  var koCount = 0, numCount = 0, badCount = 0;
  rows.forEach(function (r) {
    var s = str_(r.월원문);
    if (/^\d{1,2}월$/.test(s)) koCount++;
    else if (/^\d{1,2}$/.test(s)) numCount++;
    else badCount++;
  });

  // 정규화 후 완전 동일해지는 행을 찾는다
  var seen = {};
  var dups = [];
  rows.forEach(function (r) {
    var key = [r.연도, r.월, r.예산구분, r.사업항목, r.금액, r.비고].join('|');
    if (seen[key]) dups.push(r);
    else seen[key] = true;
  });

  var byYear = {};
  rows.forEach(function (r) { byYear[r.연도] = (byYear[r.연도] || 0) + 1; });

  var lines = [
    '[지출내역 원장 점검]',
    '  전체 ' + rows.length + '행',
    '  월 표기: "1월" 형식 ' + koCount + '행 / 숫자 형식 ' + numCount + '행' +
      (badCount ? ' / 해석 불가 ' + badCount + '행' : ''),
    '  연도별: ' + Object.keys(byYear).sort().map(function (y) {
      return y + '년 ' + byYear[y] + '행';
    }).join(', '),
    '  맞춰야 할 형식: ' + (fmt.style === 'ko' ? '"1월"' : '숫자') + ' — ' + fmt.evidence,
    '',
    '  정규화 후 완전 중복이 되는 행: ' + dups.length + '행'
  ];

  if (koCount && numCount) {
    lines.push('');
    lines.push('  ! 두 형식이 섞여 있습니다. SUMIFS 가 한쪽만 잡거나 양쪽을 모두 잡아');
    lines.push('    집계가 누락되거나 두 배가 될 수 있습니다.');
  }

  if (dups.length) {
    lines.push('');
    lines.push('  [제거 대상 — 완전히 동일한 행만]');
    dups.slice(0, 40).forEach(function (r) {
      lines.push('    ' + r.연도 + '년 ' + r.월 + '월 · ' + r.예산구분 + ' · ' +
        r.사업항목 + ' · ' + (r.금액 === null ? '(빈값)' : r.금액.toLocaleString()) + '원');
    });
    if (dups.length > 40) lines.push('    … 외 ' + (dups.length - 40) + '행');
  }

  // 사람이 확인해야 할 의심 값
  var suspicious = rows.filter(function (r) {
    return r.금액 !== null && r.금액 > 0 && r.금액 < 100;
  });
  if (suspicious.length) {
    lines.push('');
    lines.push('  [확인 필요 — 금액이 100원 미만이라 시험 입력으로 보입니다]');
    suspicious.forEach(function (r) {
      lines.push('    ' + r.연도 + '년 ' + r.월 + '월 · ' + r.사업항목 + ' · ' + r.금액 + '원');
    });
    lines.push('    (자동으로 지우지 않습니다. 직접 판단해주세요.)');
  }

  var big = rows.filter(function (r) { return r.금액 !== null && r.금액 >= 5000000; });
  if (big.length) {
    lines.push('');
    lines.push('  [확인 필요 — 500만원 이상 큰 금액]');
    big.forEach(function (r) {
      lines.push('    ' + r.연도 + '년 ' + r.월 + '월 · ' + r.사업항목 + ' · ' +
        r.금액.toLocaleString() + '원');
    });
  }

  return lines.join('\n');
}

/**
 * 월 표기를 통일하고 완전 중복 행을 제거한다.
 *
 * 같은 항목이 한 달에 두 번 있는 것은 정당할 수 있으므로
 * 연도·월·예산구분·사업항목·금액·비고가 **전부** 같은 행만 지운다.
 *
 * @param {boolean=} apply true 여야 실제로 쓴다. 기본은 미리보기.
 * @return {string} 리포트
 */
function cleanExpenseLedger(apply) {
  applyProbedLayout_();

  return withLock_(function () {
    var rows = readExpenseRows_();
    var fmt = detectExpenseMonthFormat_();

    var seen = {};
    var kept = [];
    var removed = [];
    rows.forEach(function (r) {
      var key = [r.연도, r.월, r.예산구분, r.사업항목, r.금액, r.비고].join('|');
      if (seen[key]) { removed.push(r); return; }
      seen[key] = true;
      kept.push(r);
    });

    var lines = [
      '[지출내역 원장 정리]' + (apply ? '' : ' — 미리보기 (실제로 바꾸지 않았습니다)'),
      '  월 표기를 ' + (fmt.style === 'ko' ? '"1월"' : '숫자') + ' 형식으로 통일',
      '  ' + rows.length + '행 → ' + kept.length + '행 (완전 중복 ' + removed.length + '행 제거)'
    ];

    if (!apply) {
      lines.push('');
      lines.push('  실제로 적용하려면 메뉴에서 [지출 원장 정리 실행] 을 눌러주세요.');
      return lines.join('\n');
    }

    writeExpenseRows_(kept, fmt.style);

    removed.forEach(function (r) {
      appendHistory_({
        대상기록ID: r.연도 + '-' + r.월,
        작업: '지출원장정리',
        필드: r.예산구분 + ' / ' + r.사업항목,
        이전값: r.금액,
        이후값: '(중복 행 제거)',
        수행자: '시스템',
        사유: '연도·월·구분·항목·금액·비고가 모두 동일한 중복'
      });
    });

    lines.push('  제거 내역을 _출결_이력 에 남겼습니다.');
    return lines.join('\n');
  }, 60000);
}

/* ── 사업항목 마스터 ──────────────────────────────────────────────── */

/**
 * 수입/지출 시트의 지출 표에서 (예산구분, 사업항목) 목록을 읽는다.
 *
 * 그 시트의 행 구조는 절대 건드리지 않는다 — SUMIFS 수식이 깨진다.
 * 읽기만 하고, 비어 있는 항목 행은 건너뛴다.
 * 예산구분은 병합 셀이라 값이 첫 행에만 있으므로 마지막 값을 이어 쓴다.
 *
 * @return {Array<{예산구분: string, 사업항목: string}>}
 */
function readExpenseCategories_() {
  var sh = sheet_(SHEET.수입지출, true);
  if (!sh) return [];

  var maxRow = Math.min(sh.getLastRow(), 200);
  var maxCol = Math.min(sh.getLastColumn(), 20);
  var values = sh.getRange(1, 1, maxRow, maxCol).getValues();

  // '지출 비용' 머리말을 찾는다
  var startRow = -1;
  for (var r = 0; r < values.length; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (str_(values[r][c]).replace(/\s/g, '') === '지출비용') { startRow = r; break; }
    }
    if (startRow >= 0) break;
  }
  if (startRow < 0) return [];

  // 그 아래에서 '예산구분' + '사업항목' 헤더 행을 찾는다
  var headRow = -1, catCol = -1, itemCol = -1;
  for (var r2 = startRow; r2 < Math.min(startRow + 5, values.length); r2++) {
    for (var c2 = 0; c2 < values[r2].length; c2++) {
      var s = str_(values[r2][c2]).replace(/\s/g, '');
      if (s === '예산구분') catCol = c2 + 1;
      if (s === '사업항목') itemCol = c2 + 1;
    }
    if (catCol > 0 && itemCol > 0) { headRow = r2 + 1; break; }
  }
  if (headRow < 0) return [];

  var out = [];
  var lastCat = '';
  for (var r3 = headRow; r3 < values.length; r3++) {
    var row = values[r3];
    var cat = str_(cell_(row, catCol));
    var item = str_(cell_(row, itemCol));

    if (cat) lastCat = cat;
    if (item === '소계') continue;
    if (str_(cell_(row, catCol)).replace(/\s/g, '') === '지출총합') break;
    if (item.replace(/\s/g, '') === '지출총합') break;
    if (!item) {
      // 빈 항목 행은 신규 항목을 위한 자리다. 이름이 없으면 격자에 싣지 않는다.
      continue;
    }
    out.push({ 예산구분: lastCat, 사업항목: item });
  }
  return out;
}

/* ── _지출_입력 격자 ──────────────────────────────────────────────── */

var GRID_LAYOUT = {
  yearRow: 1,
  yearLabelCol: 1,
  yearValueCol: 2,
  headerRow: 3,
  firstDataRow: 4,
  col: { 예산구분: 1, 사업항목: 2 },
  month1Col: 3
};

/**
 * 연도별 지출 입력 격자를 만든다.
 * 항목 목록은 수입/지출 시트에서 읽고, 금액은 원장에서 채운다.
 *
 * @param {number=} year 생략하면 격자에 이미 적힌 연도, 그것도 없으면 올해
 * @return {string} 리포트
 */
function buildExpenseGrid(year) {
  applyProbedLayout_();

  return withLock_(function () {
    var created = ensureSheet_(APP_SHEET.지출입력, null);
    var sh = created.sheet;

    if (!year) {
      var current = parseYear_(sh.getRange(GRID_LAYOUT.yearRow, GRID_LAYOUT.yearValueCol).getValue());
      year = current || now_().getFullYear();
    }

    var cats = readExpenseCategories_();
    if (!cats.length) {
      return '수입/지출 시트에서 사업항목 목록을 찾지 못했습니다. 시트 구조를 확인해주세요.';
    }

    // 원장에서 해당 연도 금액을 끌어온다
    var amounts = {};
    readExpenseRows_().forEach(function (r) {
      if (r.연도 !== year || !r.월) return;
      amounts[r.사업항목 + '|' + r.월] = r.금액;
    });

    var width = GRID_LAYOUT.month1Col + 11;
    var out = [];

    var titleRow = [];
    for (var i = 0; i < width; i++) titleRow.push('');
    titleRow[GRID_LAYOUT.yearLabelCol - 1] = '연도';
    titleRow[GRID_LAYOUT.yearValueCol - 1] = year;
    titleRow[2] = '← 연도를 바꾸고 [지출 격자 새로고침] 을 누르세요';
    out.push(titleRow);

    var blank = [];
    for (var b = 0; b < width; b++) blank.push('');
    out.push(blank.slice());

    var header = [];
    for (var h = 0; h < width; h++) header.push('');
    header[GRID_LAYOUT.col.예산구분 - 1] = '예산구분';
    header[GRID_LAYOUT.col.사업항목 - 1] = '사업항목';
    for (var m = 1; m <= 12; m++) header[GRID_LAYOUT.month1Col + m - 2] = m + '월';
    out.push(header);

    cats.forEach(function (c) {
      var row = [];
      for (var i2 = 0; i2 < width; i2++) row.push('');
      row[GRID_LAYOUT.col.예산구분 - 1] = c.예산구분;
      row[GRID_LAYOUT.col.사업항목 - 1] = c.사업항목;
      for (var mm = 1; mm <= 12; mm++) {
        var v = amounts[c.사업항목 + '|' + mm];
        row[GRID_LAYOUT.month1Col + mm - 2] = (v === undefined || v === null) ? '' : v;
      }
      out.push(row);
    });

    sh.clear ? sh.clear() : clearBelow_(sh, 1);
    sh.getRange(1, 1, out.length, width).setValues(out);
    sh.getRange(GRID_LAYOUT.headerRow, 1, 1, width).setFontWeight('bold').setBackground('#f0f0f0');
    sh.setFrozenRows(GRID_LAYOUT.headerRow);

    return '[지출 격자] ' + year + '년 · 항목 ' + cats.length + '개를 불러왔습니다.\n' +
      '  금액을 채운 뒤 메뉴에서 [지출 저장] 을 눌러주세요.';
  });
}

/**
 * 격자의 금액을 원장에 반영한다.
 *
 * (연도, 월, 사업항목) 을 키로 upsert 한다. 있으면 갱신, 없으면 추가.
 * 빈 칸은 행을 만들지 않고, 이미 있던 행은 지운다(금액을 지운 뜻이므로).
 * 이 방식이 지금 같은 중복 누적을 구조적으로 막는다.
 *
 * @return {string} 리포트
 */
function saveExpenseGrid() {
  applyProbedLayout_();

  return withLock_(function () {
    var sh = sheet_(APP_SHEET.지출입력, true);
    if (!sh) return '_지출_입력 시트가 없습니다. 먼저 [지출 격자 새로고침] 을 실행해주세요.';

    var year = parseYear_(sh.getRange(GRID_LAYOUT.yearRow, GRID_LAYOUT.yearValueCol).getValue());
    if (!year) return '격자의 연도를 읽을 수 없습니다.';

    var width = GRID_LAYOUT.month1Col + 11;
    var gridRows = readRows_(sh, GRID_LAYOUT.firstDataRow, width);

    // 격자에서 (사업항목, 월) → 금액
    var grid = {};
    var items = {};
    gridRows.forEach(function (row) {
      var cat = str_(cell_(row, GRID_LAYOUT.col.예산구분));
      var item = str_(cell_(row, GRID_LAYOUT.col.사업항목));
      if (!item) return;
      items[item] = cat;
      for (var m = 1; m <= 12; m++) {
        var v = toNumber_(cell_(row, GRID_LAYOUT.month1Col + m - 1));
        if (v !== null) grid[item + '|' + m] = v;
      }
    });

    var fmt = detectExpenseMonthFormat_();
    var existing = readExpenseRows_();

    var updated = 0, added = 0, deleted = 0;
    var kept = [];

    // 이 연도의 격자 대상 항목은 격자가 정답이다
    existing.forEach(function (r) {
      if (r.연도 !== year || !items[r.사업항목]) { kept.push(r); return; }
      var key = r.사업항목 + '|' + r.월;
      if (!(key in grid)) { deleted++; return; }        // 격자에서 비웠다 → 삭제
      if (r.금액 !== grid[key]) { r.금액 = grid[key]; updated++; }
      r.예산구분 = items[r.사업항목] || r.예산구분;
      kept.push(r);
      delete grid[key];                                  // 처리 완료
    });

    // 원장에 없던 칸은 새로 추가
    Object.keys(grid).forEach(function (key) {
      var parts = key.split('|');
      kept.push({
        연도: year,
        월: Number(parts[1]),
        예산구분: items[parts[0]] || '',
        사업항목: parts[0],
        금액: grid[key],
        비고: ''
      });
      added++;
    });

    writeExpenseRows_(kept, fmt.style);

    return [
      '[지출 저장] ' + year + '년',
      '  신규 ' + added + '건 · 갱신 ' + updated + '건 · 삭제 ' + deleted + '건',
      '  원장 ' + kept.length + '행',
      '  수입/지출 시트의 연도를 ' + year + '으로 바꾸면 반영된 값이 보입니다.'
    ].join('\n');
  }, 60000);
}

/**
 * 전년도 구성을 새 연도로 복사한다.
 *
 * 월세처럼 12개월 금액이 모두 같은 고정비는 금액까지 복사하고,
 * 변동비는 항목만 만들고 금액은 비운다. 격자에만 채우므로
 * [지출 저장] 을 눌러야 원장에 들어간다.
 *
 * @param {number=} targetYear 생략하면 격자에 적힌 연도
 * @return {string} 리포트
 */
function copyPreviousYearExpense(targetYear) {
  applyProbedLayout_();

  return withLock_(function () {
    var sh = sheet_(APP_SHEET.지출입력, true);
    if (!sh) return '_지출_입력 시트가 없습니다. 먼저 [지출 격자 새로고침] 을 실행해주세요.';

    var year = targetYear ||
      parseYear_(sh.getRange(GRID_LAYOUT.yearRow, GRID_LAYOUT.yearValueCol).getValue());
    if (!year) return '격자의 연도를 읽을 수 없습니다.';
    var prev = year - 1;

    // 전년도 금액을 항목×월 로 모은다
    var byItem = {};
    readExpenseRows_().forEach(function (r) {
      if (r.연도 !== prev || !r.월 || r.금액 === null) return;
      (byItem[r.사업항목] = byItem[r.사업항목] || {})[r.월] = r.금액;
    });

    var fixed = [], variable = [];
    Object.keys(byItem).forEach(function (item) {
      var months = byItem[item];
      var keys = Object.keys(months);
      var allTwelve = keys.length === 12;
      var sameAmount = allTwelve && keys.every(function (m) {
        return months[m] === months[keys[0]];
      });
      if (sameAmount) fixed.push(item); else variable.push(item);
    });

    var width = GRID_LAYOUT.month1Col + 11;
    var gridRows = readRows_(sh, GRID_LAYOUT.firstDataRow, width);
    var out = gridRows.map(function (row) {
      var item = str_(cell_(row, GRID_LAYOUT.col.사업항목));
      var copy = row.slice(0, width);
      while (copy.length < width) copy.push('');
      for (var m = 1; m <= 12; m++) {
        var idx = GRID_LAYOUT.month1Col + m - 2;
        copy[idx] = (item && fixed.indexOf(item) !== -1) ? byItem[item][m] : '';
      }
      return copy;
    });

    sh.getRange(GRID_LAYOUT.yearRow, GRID_LAYOUT.yearValueCol).setValue(year);
    if (out.length) {
      sh.getRange(GRID_LAYOUT.firstDataRow, 1, out.length, width).setValues(out);
    }

    return [
      '[전년도 구성 복사] ' + prev + '년 → ' + year + '년',
      '  고정비 ' + fixed.length + '건은 금액까지 복사: ' + (fixed.join(', ') || '없음'),
      '  변동비 ' + variable.length + '건은 항목만 남기고 비웠습니다.',
      '  확인 후 [지출 저장] 을 눌러야 원장에 들어갑니다.'
    ].join('\n');
  });
}
