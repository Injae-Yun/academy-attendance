/**
 * Util.gs — 순수 함수 모음. 시트에 의존하지 않으므로 Test.gs 에서 단독 검증 가능하다.
 */

/* ── 시각 ─────────────────────────────────────────────────────────── */

/** 지금 (Date) */
function now_() {
  return new Date();
}

/** Date → 'yyyy-MM-dd' */
function fmtDate_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

/** Date → 'HH:mm' */
function fmtTime_(d) {
  return Utilities.formatDate(d, TZ, 'HH:mm');
}

/** Date → 'yyyy-MM-dd HH:mm:ss' */
function fmtStamp_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss');
}

/** Date → 'M/d' (앞자리 0 을 빼서 바이트를 아낀다) */
function fmtShortDate_(d) {
  return Utilities.formatDate(d, TZ, 'M/d');
}

/** Date → 'yy.MM.dd' (알림톡 문구용) */
function fmtDotDate_(d) {
  return Utilities.formatDate(d, TZ, 'yy.MM.dd');
}

/**
 * 5분 격자로 내림 정렬한다. 19:07 → 19:05
 * @param {Date} d
 * @param {number=} step 분 단위 격자 (기본 5)
 */
function snapToStep_(d, step) {
  step = step || 5;
  var out = new Date(d.getTime());
  out.setSeconds(0, 0);
  out.setMinutes(Math.floor(out.getMinutes() / step) * step);
  return out;
}

/** 분을 더한 새 Date */
function addMinutes_(d, min) {
  return new Date(d.getTime() + min * 60000);
}

/** 두 Date 사이의 분 차이 (a - b) */
function diffMinutes_(a, b) {
  return (a.getTime() - b.getTime()) / 60000;
}

/**
 * 출결시각이 허용 범위인지 검사한다.
 * 미래는 금지, 과거는 소급최대분까지만 허용한다.
 *
 * @param {Date} target 사용자가 고른 출결시각
 * @param {Date} ref 기준 시각 (보통 지금)
 * @param {number} maxBackMin 소급 허용 분
 * @return {{ok: boolean, reason: string}}
 */
function validateAttendTime_(target, ref, maxBackMin) {
  var delta = diffMinutes_(target, ref);
  // 초 단위 반올림 오차와 태블릿 시계 오차를 감안해 1분까지는 미래로 본다
  if (delta > 1) {
    return { ok: false, reason: '미래 시각으로는 기록할 수 없습니다.' };
  }
  if (-delta > maxBackMin) {
    return {
      ok: false,
      reason: maxBackMin + '분보다 이전 시각은 관리자 화면에서만 입력할 수 있습니다.'
    };
  }
  return { ok: true, reason: '' };
}

/** 해당 연·월의 마지막 날 (28/29/30/31) */
function lastDayOfMonth_(year, month) {
  return new Date(year, month, 0).getDate();
}

/** 그날 00:00:00.000 */
function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/**
 * 그날 23:59:59.999
 *
 * 시트의 날짜 셀은 시각이 00:00 이라 그대로 비교하면
 * "4월 30일 종료" 가 "4월 30일 23:59" 보다 이르다고 나온다.
 * 기간의 끝을 다룰 때는 반드시 이 함수를 거친다.
 */
function endOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

/** 해당 월의 첫날 00:00 */
function monthStart_(year, month) {
  return new Date(year, month - 1, 1, 0, 0, 0, 0);
}

/** 해당 월의 마지막 날 23:59:59 */
function monthEnd_(year, month) {
  return new Date(year, month - 1, lastDayOfMonth_(year, month), 23, 59, 59, 999);
}

var WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/** 해당 연·월·일의 한글 요일 */
function weekdayKo_(year, month, day) {
  return WEEKDAY_KO[new Date(year, month - 1, day).getDay()];
}

/**
 * 시트 셀에서 읽은 값을 Date 로 정규화한다.
 *
 * 날짜만 있으면 그날 00:00, 시각이 붙어 있으면 그 시각까지 살린다.
 * 로그의 입력시각·출결시각은 'yyyy-MM-dd HH:mm:ss' 로 저장되므로
 * 시각을 버리면 5분 조정도 중복 판정도 전부 어긋난다.
 *
 * 받는 형식: Date 객체, 'yyyy-MM-dd', 'yyyy.MM.dd', 'yyyy/MM/dd',
 *            뒤에 ' HH:mm', ' HH:mm:ss', 'THH:mm:ss' 가 붙은 형태
 *
 * @return {Date|null} 해석할 수 없으면 null
 */
function toDate_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return isNaN(v.getTime()) ? null : v;
  }
  var s = String(v).trim();
  if (!s) return null;

  var m = s.match(
    /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (m) {
    var d = new Date(
      Number(m[1]), Number(m[2]) - 1, Number(m[3]),
      m[4] ? Number(m[4]) : 0,
      m[5] ? Number(m[5]) : 0,
      m[6] ? Number(m[6]) : 0,
      0
    );
    return isNaN(d.getTime()) ? null : d;
  }
  var parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * '8월', '8', 8 을 모두 숫자 8 로 바꾼다.
 * @return {number|null}
 */
function parseMonth_(v) {
  if (v === null || v === undefined || v === '') return null;
  var m = String(v).match(/(\d{1,2})/);
  if (!m) return null;
  var n = Number(m[1]);
  return n >= 1 && n <= 12 ? n : null;
}

/** '2026', 2026 을 숫자 2026 으로 */
function parseYear_(v) {
  if (v === null || v === undefined || v === '') return null;
  var m = String(v).replace(/[,\s]/g, '').match(/(\d{4})/);
  return m ? Number(m[1]) : null;
}

/* ── 전화번호 ─────────────────────────────────────────────────────── */

/**
 * 전화번호를 숫자만 남긴 국내 형식으로 정규화한다.
 * '010-1234-5678', '01012345678', '+82 10-1234-5678' → '01012345678'
 * @return {string} 정규화 실패 시 빈 문자열
 */
function normalizePhone_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (!s) return '';

  s = s.replace(/[^\d+]/g, '');
  if (s.indexOf('+82') === 0) s = '0' + s.slice(3);
  else if (s.indexOf('82') === 0 && s.length >= 11 && s.charAt(2) !== '0') s = '0' + s.slice(2);
  s = s.replace(/\D/g, '');

  // 국내 휴대폰/유선 길이 범위를 벗어나면 신뢰하지 않는다
  if (s.length < 9 || s.length > 11) return '';
  return s;
}

/**
 * 번호를 국번에 맞게 끊는다.
 *
 * 서울(02)만 지역번호가 두 자리라 따로 봐야 한다.
 * 학원 발신번호가 유선인 경우가 흔한데, 02-1234-5678 을
 * 일괄 3자리로 끊으면 021-234-5678 이라는 엉뚱한 번호로 보인다.
 *
 * @return {{head: string, mid: string, tail: string}|null}
 */
function splitPhone_(digits) {
  var s = digits;
  if (!s) return null;

  var headLen = (s.indexOf('02') === 0 && s.length <= 10) ? 2 : 3;
  var head = s.slice(0, headLen);
  var rest = s.slice(headLen);
  if (rest.length < 7) {
    return { head: head, mid: rest.slice(0, rest.length - 4), tail: rest.slice(-4) };
  }
  return { head: head, mid: rest.slice(0, rest.length - 4), tail: rest.slice(-4) };
}

/** 정규화된 번호를 '010-1234-5678' / '02-1234-5678' 로 예쁘게 */
function formatPhone_(v) {
  var s = normalizePhone_(v);
  if (!s) return '';
  var p = splitPhone_(s);
  if (!p || !p.mid) return s;
  return p.head + '-' + p.mid + '-' + p.tail;
}

/** 앱 화면용 마스킹. '010-****-5678' */
function maskPhone_(v) {
  var s = normalizePhone_(v);
  if (!s) return '';
  var p = splitPhone_(s);
  if (!p) return s;
  return p.head + '-****-' + p.tail;
}

/* ── 문자 바이트 ──────────────────────────────────────────────────── */

/**
 * SMS 과금 기준 바이트 수를 센다.
 * 국내 이동통신사는 EUC-KR(CP949) 기준이라 한글·전각 문자는 2바이트다.
 * 90바이트를 넘으면 LMS 로 자동 전환되어 단가가 약 3배가 된다.
 */
function byteLengthEucKr_(s) {
  if (!s) return 0;
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    n += s.charCodeAt(i) > 0x7f ? 2 : 1;
  }
  return n;
}

/**
 * SMS 로 보낼 수 없는 문자를 걷어낸다.
 *
 * 알림톡은 이모지를 받지만 국내 SMS/LMS 는 EUC-KR 기준이라 표현할 수 없다.
 * 그대로 보내면 대행사에 따라 '?' 로 치환되거나 전송이 거부된다.
 *
 * 알림톡 문구와 SMS 문구를 따로 두지 않고 여기서 걷어내는 이유는,
 * 두 벌을 두면 한쪽만 고쳐 놓고 반드시 어긋나기 때문이다.
 *
 * ♩♪♬ 같은 기호는 EUC-KR(KS X 1001)에 들어 있지만, 대행사·단말마다
 * 처리가 갈려 확실한 것만 남기고 나머지는 지운다. 덜 지우는 것보다
 * 더 지우는 쪽이 안전하다 — 기호가 빠져도 뜻은 그대로다.
 */
function stripEmoji_(s) {
  if (s === null || s === undefined) return '';
  var out = '';

  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);

    // 서러게이트 페어 = BMP 밖 = EUC-KR 에 없다 (🎶 🍀 등)
    if (c >= 0xd800 && c <= 0xdbff) { i++; continue; }
    if (c >= 0xdc00 && c <= 0xdfff) continue;      // 짝 잃은 뒷자리

    if (c === 0x200d) continue;                    // ZWJ (이모지 결합)
    if (c >= 0xfe00 && c <= 0xfe0f) continue;      // 변형 선택자 (️ 등)
    if (c >= 0x2600 && c <= 0x27bf) continue;      // 기타 기호·딩벳 (✨ ☀ ✔)
    if (c >= 0x2b00 && c <= 0x2bff) continue;      // 화살표·도형
    if (c >= 0x1f00 && c <= 0x1fff) continue;      // 그리스 확장 (거의 안 쓰인다)

    out += s.charAt(i);
  }

  // 문자가 빠지며 생긴 겹공백과 줄 끝 공백을 정리한다
  return out
    .split('\n')
    .map(function (line) { return line.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/, ''); })
    .join('\n');
}

var SMS_MAX_BYTES = 90;

/** SMS 한 건으로 나갈 수 있는 길이인지 */
function fitsInSms_(s) {
  return byteLengthEucKr_(s) <= SMS_MAX_BYTES;
}

/**
 * 90바이트에 맞도록 학원명을 줄여 본다.
 * 그래도 넘치면 원문을 그대로 돌려주고 호출자가 LMS 로 보낸다.
 *
 * @param {function(string): string} build 학원명을 받아 본문을 만드는 함수
 * @param {string} academy 학원명
 * @return {{text: string, bytes: number, fits: boolean, shortened: boolean}}
 */
function fitSmsText_(build, academy) {
  var full = build(academy);
  if (fitsInSms_(full)) {
    return { text: full, bytes: byteLengthEucKr_(full), fits: true, shortened: false };
  }
  // 학원명을 뒤에서부터 한 글자씩 줄인다 (최소 2글자는 남긴다)
  for (var len = academy.length - 1; len >= 2; len--) {
    var candidate = build(academy.slice(0, len));
    if (fitsInSms_(candidate)) {
      return { text: candidate, bytes: byteLengthEucKr_(candidate), fits: true, shortened: true };
    }
  }
  return { text: full, bytes: byteLengthEucKr_(full), fits: false, shortened: false };
}

/* ── 한글 초성 ────────────────────────────────────────────────────── */

var CHOSUNG_TABLE = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ',
  'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
];
var HANGUL_BASE = 0xac00;
var HANGUL_LAST = 0xd7a3;

/**
 * 문자열의 초성을 뽑는다. '홍길동' → 'ㅎㄱㄷ'
 * 한글이 아닌 문자는 그대로 둔다.
 */
function getChosung_(s) {
  if (!s) return '';
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    if (code >= HANGUL_BASE && code <= HANGUL_LAST) {
      out += CHOSUNG_TABLE[Math.floor((code - HANGUL_BASE) / 588)];
    } else {
      out += s.charAt(i);
    }
  }
  return out;
}

/**
 * 명부 검색어가 이름에 걸리는지 판정한다.
 * 이름 부분일치와 초성 부분일치를 모두 지원한다.
 * '홍' / '길동' / 'ㅎㄱㄷ' / 'ㄱㄷ' 모두 '홍길동' 에 걸린다.
 */
function matchesQuery_(name, query) {
  if (!query) return true;
  var n = String(name);
  var q = String(query).trim();
  if (!q) return true;

  // 자음만 쳤을 때에만 초성으로 본다.
  // 완성된 글자까지 초성으로 대조하면 '홍' 이 '김하늘'(ㄱㅎㄴ) 을 잡는다.
  if (/^[ㄱ-ㅎ]+$/.test(q)) return getChosung_(n).indexOf(q) !== -1;
  return n.indexOf(q) !== -1;
}

/* ── 동명이인 접미사 ──────────────────────────────────────────────── */

var SUFFIX_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * 표시명에서 동명이인 접미사를 떼어 (기본이름, 접미사) 로 나눈다.
 * '홍길동A' → {base:'홍길동', suffix:'A'}
 * '홍길동'  → {base:'홍길동', suffix:''}
 *
 * 접미사는 이름 끝의 영문 대문자 한 글자이며 공백이 없다.
 * 이름 자체가 영문인 경우를 대비해 앞에 한글이 있을 때만 접미사로 본다.
 */
function splitDisplayName_(displayName) {
  var s = String(displayName || '').trim();
  var m = s.match(/^(.*[가-힣])([A-Z])$/);
  if (m) return { base: m[1], suffix: m[2] };
  return { base: s, suffix: '' };
}

/**
 * 이미 쓰인 접미사 목록을 보고 다음 접미사를 발급한다.
 * 재사용하지 않는다 — 최대값 다음 글자를 준다.
 *
 * 첫 번째 학생은 접미사가 없고(''), 중복이 생긴 시점부터 A, B, C … 가 붙는다.
 * 'A' 가 퇴소해도 다음 학생은 'A' 를 물려받지 않는다.
 *
 * @param {string[]} usedSuffixes 같은 기본이름으로 지금까지 쓰인 접미사들 ('' 포함)
 * @return {string} 새로 발급할 접미사
 * @throws 27명(무표기 + A~Z)을 넘으면 오류
 */
function nextSuffix_(usedSuffixes) {
  var used = usedSuffixes || [];
  if (used.length === 0) return '';

  var maxIdx = -1;   // '' 는 -1 로 본다
  for (var i = 0; i < used.length; i++) {
    var s = String(used[i] || '');
    if (s === '') {
      if (maxIdx < -1) maxIdx = -1;
      continue;
    }
    var idx = SUFFIX_ALPHABET.indexOf(s);
    if (idx > maxIdx) maxIdx = idx;
  }

  var next = maxIdx + 1;
  if (next >= SUFFIX_ALPHABET.length) {
    throw new Error(
      '동명이인 접미사가 소진되었습니다 (최대 27명). 관리자 확인이 필요합니다.'
    );
  }
  return SUFFIX_ALPHABET.charAt(next);
}

/** 기본이름 + 접미사 → 표시명 */
function makeDisplayName_(base, suffix) {
  return suffix ? base + suffix : base;
}

/* ── 과목 ─────────────────────────────────────────────────────────── */

/**
 * 수강생명단의 과목을 출석부 행 단위로 쪼갠다.
 *
 * 단일 과목은 원문을 그대로 쓴다 — '피아노(초등부)' → ['피아노(초등부)']
 * 복수 과목만 '+' 로 나눈다   — '피아노+작곡'     → ['피아노', '작곡']
 *
 * 단일 과목의 학년부 정보를 잃지 않으면서, 복수 과목은 행을 나눌 수 있게 한다.
 */
function splitSubjects_(subject) {
  var s = String(subject || '').trim();
  if (!s) return [''];
  if (s.indexOf('+') === -1) return [s];

  var parts = s.split('+').map(function (p) { return p.trim(); })
    .filter(function (p) { return p !== ''; });
  return parts.length ? parts : [s];
}

/** 성인 대상 과목인지 (신규 학생의 알림수신 기본값을 정한다) */
function isAdultSubject_(subject) {
  return String(subject || '').indexOf(ADULT_SUBJECT_KEYWORD) !== -1;
}

/* ── 기타 ─────────────────────────────────────────────────────────── */

/** 'S001' 형태의 순번 ID */
function formatSeqId_(prefix, n, width) {
  var s = String(n);
  while (s.length < (width || 3)) s = '0' + s;
  return prefix + s;
}

/** 'S042' → 42. 형식이 아니면 0 */
function parseSeqId_(prefix, id) {
  var s = String(id || '');
  if (s.indexOf(prefix) !== 0) return 0;
  var n = parseInt(s.slice(prefix.length), 10);
  return isNaN(n) ? 0 : n;
}

/** 셀 값을 트림된 문자열로 */
function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

/** 체크박스/문자열을 불리언으로 */
function bool_(v) {
  if (v === true) return true;
  if (v === false || v === '' || v === null || v === undefined) return false;
  var s = String(v).trim().toUpperCase();
  return s === 'TRUE' || s === 'Y' || s === '예' || s === '1' || s === 'O';
}

/** 금액 문자열을 숫자로. '2,000,000' → 2000000, 빈 값 → null */
function toNumber_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isNaN(v) ? null : v;
  var s = String(v).replace(/[,\s₩원]/g, '');
  if (!s) return null;
  var n = Number(s);
  return isNaN(n) ? null : n;
}

/** 열 번호(1-based) → 'A', 'AA' 같은 A1 표기 */
function colToA1_(col) {
  var s = '';
  var n = col;
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** PIN 을 salt 와 함께 해시한다. 평문 저장을 피하기 위함이다. */
function hashPin_(pin, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || '') + ':' + String(pin),
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}
