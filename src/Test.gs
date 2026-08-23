/**
 * Test.gs — Apps Script 편집기에서 직접 실행하는 검증 함수.
 *
 * Apps Script 에는 테스트 러너가 없으므로 함수를 골라 실행하고
 * 실행 로그(Ctrl+Enter)로 결과를 본다.
 *
 * 순수 함수 검증은 로컬에서 Node 로도 돌린다(scratchpad/test-*.js).
 * 여기 있는 것은 실제 시트에 붙은 뒤 확인하는 용도다.
 *
 * ⚠ 시트를 건드리는 함수는 반드시 원본의 **사본**에서 먼저 실행할 것.
 */

var __t = { pass: 0, fail: 0, lines: [] };

function __reset() { __t = { pass: 0, fail: 0, lines: [] }; }

function __eq(label, actual, expected) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { __t.pass++; }
  else { __t.fail++; __t.lines.push('✗ ' + label + '\n    기대: ' + e + '\n    실제: ' + a); }
}

function __ok(label, cond, detail) {
  if (cond) { __t.pass++; }
  else { __t.fail++; __t.lines.push('✗ ' + label + (detail ? '\n    ' + detail : '')); }
}

function __report(title) {
  var out = [title, '통과 ' + __t.pass + ' / 실패 ' + __t.fail];
  if (__t.lines.length) out = out.concat('', __t.lines);
  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/* ── 순수 함수 (시트를 건드리지 않는다) ──────────────────────────── */

/** 메시지 바이트 · 초성 · 전화번호 · 시각 · 접미사 · 과목 분리 */
function testPureFunctions() {
  __reset();

  // SMS 바이트 — 90 을 넘으면 LMS 로 자동 전환되어 단가가 3배가 된다.
  // 학원명 길이에 따라 바이트가 달라지므로 상수로 박지 않고 계산으로 확인한다.
  var 문구 = '[음악학원] 홍길동 학생이 8/21 19:05에 등원했습니다.';
  __eq('한글 1자 = 2바이트', byteLengthEucKr_('가나다'), 6);
  __eq('영문 1자 = 1바이트', byteLengthEucKr_('abc'), 3);
  __eq('문구 바이트', byteLengthEucKr_(문구), 51);
  __ok('등원 문구 SMS 적합', fitsInSms_(문구));
  __eq('90바이트 경계', fitsInSms_(new Array(46).join('가')), true);
  __ok('실제 학원명으로도 안전', fitsInSms_(
    '[' + getAcademyName_() + '] 남궁철수 학생이 8/21 19:05에 하원했습니다.'));

  // 초성 검색
  __eq('초성 추출', getChosung_('홍길동'), 'ㅎㄱㄷ');
  __ok('초성 검색', matchesQuery_('남궁철수', 'ㄴㄱ'));
  __ok('이름 부분일치', matchesQuery_('남궁철수', '승기'));

  // 전화번호
  __eq('하이픈 정규화', normalizePhone_('010-1234-5678'), '01012345678');
  __eq('국가번호 제거', normalizePhone_('+82 10-1234-5678'), '01012345678');
  __eq('마스킹', maskPhone_('010-1234-5678'), '010-****-5678');
  __eq('쓰레기 값 거부', normalizePhone_('없음'), '');

  // 시각
  var ref = new Date(2026, 7, 21, 19, 7);
  __eq('5분 스냅', fmtTime_(snapToStep_(ref)), '19:05');
  __eq('◀5분 두 번', fmtTime_(addMinutes_(ref, -10)), '18:57');
  __ok('현재 허용', validateAttendTime_(ref, ref, 120).ok);
  __ok('미래 거부', !validateAttendTime_(addMinutes_(ref, 5), ref, 120).ok);
  __ok('121분 소급 거부', !validateAttendTime_(addMinutes_(ref, -121), ref, 120).ok);

  // 동명이인 접미사 — 재사용 금지가 핵심
  __eq('첫 학생 무표기', nextSuffix_([]), '');
  __eq('두 번째 A', nextSuffix_(['']), 'A');
  __eq('A 퇴소해도 다음은 C', nextSuffix_(['', 'A', 'B']), 'C');
  __eq('표시명 분해', splitDisplayName_('홍길동A'), { base: '홍길동', suffix: 'A' });

  // 과목 분리
  __eq('단일 과목 원문 유지', splitSubjects_('피아노(초등부)'), ['피아노(초등부)']);
  __eq('복수 과목 분리', splitSubjects_('피아노+작곡'), ['피아노', '작곡']);
  __ok('성인반 판정', isAdultSubject_('피아노(성인반)'));

  // 말일 · 요일
  __eq('2월 말일', lastDayOfMonth_(2026, 2), 28);
  __eq('윤년 2월 말일', lastDayOfMonth_(2028, 2), 29);
  __eq('2026-08-01 요일', weekdayKo_(2026, 8, 1), '토');

  return __report('[순수 함수 검증]');
}

/** 실측된 좌표가 우리가 기대하는 열과 맞는지 */
function testLayout() {
  __reset();
  applyProbedLayout_();

  __ok('좌표 실측값 존재',
    !!PropertiesService.getScriptProperties().getProperty(LAYOUT_PROP_KEY),
    'probeLayout() 을 먼저 실행하세요.');

  __eq('출석부 1일 열', colToA1_(BOOK_LAYOUT.day1Col), 'F');
  __eq('출석부 31일 열', colToA1_(BOOK_LAYOUT.day1Col + 30), 'AJ');
  __eq('원장 1일 열', colToA1_(LEDGER_LAYOUT.day1Col), 'G');
  __eq('원장 31일 열', colToA1_(LEDGER_LAYOUT.day1Col + 30), 'AK');

  var ym = getBookYearMonth_();
  __ok('출석부 연/월 읽기', !!ym, '연도/수강월 셀을 확인하세요.');
  if (ym) Logger.log('  출석부가 보고 있는 기간: ' + ym.year + '년 ' + ym.month + '월');

  // 헤더 텍스트가 실제로 그 자리에 있는지 되짚어 본다
  var roster = sheet_(SHEET.수강생명단);
  __eq('수강생명단 이름 헤더',
    str_(roster.getRange(ROSTER_LAYOUT.headerRow, ROSTER_LAYOUT.col.이름).getValue()).replace('*', ''),
    '이름');
  __eq('수강생명단 연락처 헤더',
    str_(roster.getRange(ROSTER_LAYOUT.headerRow, ROSTER_LAYOUT.col.보호자연락처).getValue()),
    '보호자 연락처');

  return __report('[좌표 실측 검증]');
}

/* ── 시트 상태 점검 (읽기만 한다) ────────────────────────────────── */

/** 현재 명부 상태를 사람이 읽을 수 있게 요약한다. */
function testRosterState() {
  __reset();
  applyProbedLayout_();

  var students = readStudents_();
  var 재원 = students.filter(function (s) { return s.상태 === ST.재원; });
  var 성인 = 재원.filter(function (s) { return isAdultSubject_(s.과목); });
  var 미등록 = 재원.filter(function (s) { return !s.보호자연락처; });

  __ok('학생 마스터에 데이터 있음', students.length > 0, 'syncRoster() 를 먼저 실행하세요.');
  __ok('학생ID 중복 없음', (function () {
    var seen = {}, dup = false;
    students.forEach(function (s) { if (seen[s.학생ID]) dup = true; seen[s.학생ID] = true; });
    return !dup;
  })());
  __ok('표시명 중복 없음', (function () {
    var seen = {}, dup = false;
    students.forEach(function (s) {
      var d = s.표시명 || s.이름;
      if (seen[d]) dup = true;
      seen[d] = true;
    });
    return !dup;
  })(), '동명이인 접미사가 제대로 발급되지 않았을 수 있습니다.');
  __ok('성인반은 알림수신 OFF',
    성인.filter(function (s) { return s.알림수신; }).length === 0);

  Logger.log([
    '  전체 ' + students.length + '명',
    '  재원 ' + 재원.length + '명 (성인반 ' + 성인.length + '명)',
    '  연락처 미등록 ' + 미등록.length + '명' +
      (미등록.length ? ': ' + 미등록.slice(0, 10).map(function (s) {
        return s.표시명 || s.이름;
      }).join(', ') + (미등록.length > 10 ? ' 외 ' + (미등록.length - 10) + '명' : '') : ''),
    '  출석부행 미매핑 ' + 재원.filter(function (s) { return !s.출석부행; }).length + '명'
  ].join('\n'));

  return __report('[명부 상태]');
}

/** 원장과 출석부의 출결 기록 수가 맞는지 */
function testAttendbookState() {
  __reset();
  applyProbedLayout_();

  var ym = getBookYearMonth_();
  if (!ym) { __ok('출석부 연/월', false, '읽을 수 없습니다.'); return __report('[출석부 상태]'); }

  var ledger = readLedgerRows_().filter(function (r) {
    return r.연도 === ym.year && r.월 === ym.month;
  });
  var ledgerMarks = ledger.reduce(function (a, r) {
    return a + Object.keys(r.days).length;
  }, 0);

  var sh = sheet_(SHEET.출석부);
  var bookMarks = 0, bookRows = 0;
  readRows_(sh, BOOK_LAYOUT.firstDataRow, BOOK_LAYOUT.특이사항Col).forEach(function (row) {
    if (!str_(cell_(row, BOOK_LAYOUT.col.이름))) return;
    bookRows++;
    for (var d = 1; d <= 31; d++) {
      if (str_(cell_(row, BOOK_LAYOUT.day1Col + d - 1))) bookMarks++;
    }
  });

  __eq('원장과 출석부의 기록 수 일치', bookMarks, ledgerMarks);
  __eq('원장과 출석부의 행 수 일치', bookRows, ledger.length);
  __ok('이름에 P/C 접미사가 남아있지 않음', (function () {
    var bad = ledger.filter(function (r) { return /\s[A-Za-z]$/.test(r.이름); });
    if (bad.length) Logger.log('  남은 접미사: ' + bad.map(function (r) { return r.이름; }).join(', '));
    return bad.length === 0;
  })());

  Logger.log('  ' + ym.year + '년 ' + ym.month + '월 · 행 ' + ledger.length +
    '개 · 기록 ' + ledgerMarks + '칸');

  return __report('[출석부 상태]');
}

/** 지출 원장 상태 (analyzeExpenseLedger 의 요약본) */
function testExpenseState() {
  __reset();
  applyProbedLayout_();

  var rows = readExpenseRows_();
  var ko = 0, num = 0;
  rows.forEach(function (r) {
    var s = str_(r.월원문);
    if (/^\d{1,2}월$/.test(s)) ko++;
    else if (/^\d{1,2}$/.test(s)) num++;
  });

  var seen = {}, dup = 0;
  rows.forEach(function (r) {
    var k = [r.연도, r.월, r.예산구분, r.사업항목, r.금액, r.비고].join('|');
    if (seen[k]) dup++; else seen[k] = true;
  });

  __eq('월 표기 형식이 하나로 통일됨', ko && num ? 2 : 1, 1);
  __eq('완전 중복 행 없음', dup, 0);

  Logger.log('  ' + rows.length + '행 · "N월" ' + ko + ' / 숫자 ' + num + ' · 중복 ' + dup);
  Logger.log(analyzeExpenseLedger());

  return __report('[지출 원장 상태]');
}

/** 위 점검을 한 번에 */
function testAll() {
  var out = [
    testPureFunctions(),
    testLayout(),
    testRosterState(),
    testAttendbookState(),
    testExpenseState()
  ].join('\n\n');
  Logger.log('\n===== 전체 =====\n' + out);
  return out;
}
