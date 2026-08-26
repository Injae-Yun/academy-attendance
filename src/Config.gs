/**
 * Config.gs — 시트 이름, 열 좌표, 설정값 상수와 로더.
 *
 * 기존 11개 시트의 행 위치는 시트마다 다르고 템플릿 버전에 따라 밀릴 수 있다.
 * 그래서 Setup.probeLayout() 이 헤더 텍스트를 찾아 실측한 뒤
 * Script Properties 에 저장하고, applyProbedLayout_() 이 그 값으로 덮어쓴다.
 * 아래 상수는 실측 전 기본값(힌트)일 뿐이며 실측값이 항상 우선한다.
 */

/** 기존 시트 이름. probeLayout() 이 실제 이름으로 교정한다. */
var SHEET = {
  기본정보: '기본정보',
  대시보드: '대시보드',
  출석부: '출석부',
  출석부누적: '출석부(DB)',
  수강생명단: '수강생명단',
  휴원생명단: '휴원생명단',
  퇴소생명단: '퇴소생명단',
  수강료누적: '수강료(누적)',
  수강료월별: '수강료(월별)',
  수입지출: '수입/지출',
  지출원장: '지출(DB)'
};

/** 앱이 새로 만드는 시트. 기존 시트와 섞이지 않도록 접두어를 쓴다. */
var APP_SHEET = {
  학생: '_출결_학생',
  로그: '_출결_로그',
  기기: '_출결_기기',
  설정: '_출결_설정',
  이력: '_출결_이력',
  지출입력: '_지출_입력'
};

/**
 * 숨길 시트.
 *
 * 기기 시트에는 접속 토큰이 들어 있어 감춘다. 토큰을 아는 사람은
 * 그 태블릿과 같은 권한을 갖는다.
 * 설정 시트는 사람이 직접 고쳐야 하므로 보이게 둔다.
 * API 키·시크릿은 시트가 아니라 Script Properties 에 있다.
 */
var HIDDEN_APP_SHEETS = ['_출결_기기'];

/* ── 기존 시트 좌표 (실측 전 기본값) ──────────────────────────────── */

/**
 * 수강생명단 — B열부터 시작한다.
 * B=이름 C=과목 D=성별 E=수강일수 F=학원비 G=결제방법
 * H=보호자성함 I=보호자연락처 J=등록일 K=수강료납부일 L=메모
 */
var ROSTER_LAYOUT = {
  headerRow: 4,
  firstDataRow: 5,
  col: {
    이름: 2,
    과목: 3,
    성별: 4,
    수강일수: 5,
    학원비: 6,
    결제방법: 7,
    보호자성함: 8,
    보호자연락처: 9,
    등록일: 10,
    수강료납부일: 11,
    메모: 12
  }
};

/** 휴원생명단 — 수강생명단과 같고 L부터 고유 열이 붙는다. */
var LEAVE_LAYOUT = {
  headerRow: 4,
  firstDataRow: 5,
  col: {
    이름: 2,
    과목: 3,
    보호자연락처: 9,
    등록일: 10,
    휴원시작일: 12,
    휴원종료일: 13,
    메모: 14,
    휴원이유: 15
  }
};

/** 퇴소생명단 */
var QUIT_LAYOUT = {
  headerRow: 4,
  firstDataRow: 5,
  col: {
    이름: 2,
    과목: 3,
    보호자연락처: 9,
    등록일: 10,
    퇴소일: 12,
    최종수강기간: 13,
    퇴소이유: 14
  }
};

/**
 * 출석부 — 월별 인쇄용 뷰.
 * B=번호 C=이름 D=과목명 E=수강요일 F=1일 … AJ=31일 AK=특이사항
 */
var BOOK_LAYOUT = {
  academyRow: 2,
  titleRow: 3,
  yearCell: 'H2',
  monthCell: 'H3',
  weekdayRow: 4,
  headerRow: 5,
  firstDataRow: 6,
  col: { 번호: 2, 이름: 3, 과목명: 4, 수강요일: 5 },
  day1Col: 6,
  특이사항Col: 37
};

/**
 * 출석부(DB) — 출결 원장. 연도·수강월별로 영구 보관한다. 실제 파일에서는 숨김 시트다.
 * A=연도 B=수강월 C=번호 D=이름 E=과목명 F=수강요일 G=1일 … AK=31일 AL=특이사항
 */
var LEDGER_LAYOUT = {
  headerRow: 1,
  firstDataRow: 2,
  col: { 연도: 1, 수강월: 2, 번호: 3, 이름: 4, 과목명: 5, 수강요일: 6 },
  day1Col: 7,
  특이사항Col: 38
};

/** 지출내역 원장 — 연도|월|예산구분|사업항목|금액|비고 */
var EXPENSE_LAYOUT = {
  headerRow: 1,
  firstDataRow: 2,
  col: { 연도: 1, 월: 2, 예산구분: 3, 사업항목: 4, 금액: 5, 비고: 6 }
};

/* ── 앱 시트 열 정의 ─────────────────────────────────────────────── */

var STUDENT_COL = {
  학생ID: 1, 이름: 2, 표시명: 3, 과목: 4, 등록일: 5,
  보호자연락처: 6, 알림수신: 7, PIN: 8, 출석부행: 9,
  상태: 10, 동기화시각: 11
};
var STUDENT_HEADERS = [
  '학생ID', '이름', '표시명', '과목', '등록일',
  '보호자연락처', '알림수신', 'PIN', '출석부행', '상태', '동기화시각'
];

/*
 * 과목은 맨 뒤(O열)에 붙인다.
 * 중간에 끼우면 이미 쌓인 로그의 열이 통째로 밀려 값이 어긋난다.
 */
var LOG_COL = {
  기록ID: 1, 입력시각: 2, 출결시각: 3, 학생ID: 4, 이름: 5,
  구분: 6, 상태: 7, 기기: 8, 발송상태: 9, 발송채널: 10,
  메시지ID: 11, 발송시각: 12, 오류: 13, 비고: 14, 과목: 15
};
var LOG_HEADERS = [
  '기록ID', '입력시각', '출결시각', '학생ID', '이름',
  '구분', '상태', '기기', '발송상태', '발송채널',
  '메시지ID', '발송시각', '오류', '비고', '과목'
];

var DEVICE_COL = { 토큰: 1, 별명: 2, 모드: 3, 등록일: 4, 마지막사용: 5, 활성: 6 };
var DEVICE_HEADERS = ['토큰', '별명', '모드', '등록일', '마지막사용', '활성'];

var HISTORY_COL = {
  이력ID: 1, 시각: 2, 대상기록ID: 3, 작업: 4, 필드: 5,
  이전값: 6, 이후값: 7, 수행자: 8, 사유: 9
};
var HISTORY_HEADERS = [
  '이력ID', '시각', '대상기록ID', '작업', '필드',
  '이전값', '이후값', '수행자', '사유'
];

var SETTING_HEADERS = ['키', '값', '설명'];

/* ── 열거값 ───────────────────────────────────────────────────────── */

var ST = { 재원: '재원', 휴원: '휴원', 퇴소: '퇴소', 확인필요: '확인필요' };
var KIND = { 등원: '등원', 하원: '하원' };
var LOGST = { 정상: '정상', 수정됨: '수정됨', 취소됨: '취소됨' };
var SENDST = {
  대기: '대기',
  발송중: '발송중',
  성공: '성공',
  실패: '실패',
  수신거부: '미발송(수신거부)',
  번호없음: '미발송(번호없음)',
  관리자: '미발송(관리자)'
};
var MODE = { 키오스크: 'kiosk', 직원: 'staff' };

/** 출석부 출결 기호 */
var MARK = { 출석: 'O', 지각: '△', 결석: 'X' };

/** 성인반 판정에 쓰는 과목 키워드 */
var ADULT_SUBJECT_KEYWORD = '성인';

/* ── 설정 기본값 ─────────────────────────────────────────────────── */

/**
 * 알림 문구. 등원·하원을 #{등하원조건} 하나로 갈아 끼워 템플릿을 한 벌만 쓴다.
 *
 * 알림톡 템플릿은 건마다 따로 심사받아야 하는데, 두 벌이면 심사도 두 번이고
 * 나중에 문구를 고칠 때 한쪽만 고쳐 놓기 십상이다.
 *
 * 이모지는 알림톡에서만 나간다. SMS 로 대체될 때는 stripEmoji_ 가 걷어낸다.
 */
var MSG_DEFAULT =
  '[#{학원명}🎶]\n\n#{날짜} #{학생명} 학생이 #{시간}에 #{등하원조건}하였습니다.#{이모티콘}';

/**
 * #{등하원조건} 과 #{이모티콘} 에 들어갈 값.
 *
 * 둘 다 알림톡 변수값이라 바꿔도 재심사가 필요 없다.
 * 이모지를 맞바꾸려면 아래 두 글자만 서로 바꾸면 된다.
 */
var KIND_WORD = { 등원: '출석', 하원: '하원' };
var KIND_EMOJI = { 등원: '✨', 하원: '🍀' };

var SETTING_DEFAULTS = {
  웹앱주소: ['',
    '배포 → 배포 관리 에서 복사한 웹 앱 URL (…/exec 로 끝나는 주소). ' +
    '메뉴의 [출결 앱 열기]·[관리자 화면 열기] 가 이 값을 씁니다. ' +
    '비워두면 편집자만 열 수 있는 /dev 주소가 안내되어 태블릿에서 열리지 않습니다.'],
  문구: [MSG_DEFAULT,
    '⚠ 알림톡 사용 중에는 수정 금지 — 심사 통과한 템플릿과 글자가 하나라도 다르면 발송이 거부됩니다. ' +
    '템플릿을 새로 심사받았을 때만 그 문구에 맞춰 고치세요. ' +
    '변수: #{학원명} #{학생명} #{날짜} #{시간} #{등하원조건}(출석/하원) #{이모티콘}. ' +
    '이모지는 알림톡에만 나가고 SMS 로 대체될 때는 자동으로 빠집니다.'],
  발신번호: ['', '통신서비스 이용증명원으로 사전등록한 학원 대표번호'],
  공급사: ['', 'solapi 또는 aligo'],
  발신프로필키: ['', '알림톡 발신프로필 키 (senderKey)'],
  템플릿ID: ['', '알림톡 템플릿 코드. 등·하원이 #{등하원조건} 으로 갈리므로 한 벌만 씁니다'],
  SMS폴백사용: ['TRUE', '알림톡 실패 시 SMS로 대체 발송'],
  관리자PIN해시: ['', 'Setup.setAdminPin() 으로 설정한다. 평문 저장 금지'],
  중복차단분: ['10', '같은 학생·같은 구분을 이 시간 안에 다시 누르면 확인을 요청한다'],
  소급최대분: ['120', '출결시각을 과거로 되돌릴 수 있는 최대 범위(분)']
};

/** API 키·시크릿은 시트가 아니라 Script Properties 에 둔다. */
var SECRET_KEY = {
  solapiApiKey: 'SOLAPI_API_KEY',
  solapiApiSecret: 'SOLAPI_API_SECRET',
  aligoApiKey: 'ALIGO_API_KEY',
  aligoUserId: 'ALIGO_USER_ID',
  adminPinSalt: 'ADMIN_PIN_SALT',
  optoutSalt: 'OPTOUT_SALT'
};

var LAYOUT_PROP_KEY = 'PROBED_LAYOUT';
var TZ = 'Asia/Seoul';

/* ── 로더 ─────────────────────────────────────────────────────────── */

/** 활성 스프레드시트 */
function ss_() {
  return SpreadsheetApp.getActive();
}

/**
 * 시트를 이름으로 가져온다.
 * @param {string} name 시트 이름
 * @param {boolean=} optional true 면 없을 때 null 을 반환한다
 */
function sheet_(name, optional) {
  var sh = ss_().getSheetByName(name);
  if (!sh && !optional) {
    throw new Error('시트를 찾을 수 없습니다: "' + name + '"');
  }
  return sh;
}

/**
 * probeLayout() 이 저장해 둔 실측 좌표를 상수에 덮어씌운다.
 * 시트를 건드리는 모든 진입점에서 가장 먼저 호출한다.
 * @return {boolean} 실측값을 적용했는지 여부
 */
function applyProbedLayout_() {
  var raw = PropertiesService.getScriptProperties().getProperty(LAYOUT_PROP_KEY);
  if (!raw) return false;

  var probed;
  try {
    probed = JSON.parse(raw);
  } catch (e) {
    return false;
  }

  var targets = {
    SHEET: SHEET,
    ROSTER_LAYOUT: ROSTER_LAYOUT,
    LEAVE_LAYOUT: LEAVE_LAYOUT,
    QUIT_LAYOUT: QUIT_LAYOUT,
    BOOK_LAYOUT: BOOK_LAYOUT,
    LEDGER_LAYOUT: LEDGER_LAYOUT,
    EXPENSE_LAYOUT: EXPENSE_LAYOUT
  };
  Object.keys(targets).forEach(function (k) {
    if (probed[k]) mergeInto_(targets[k], probed[k]);
  });
  return true;
}

/** 얕은 재귀 병합. src 의 값으로 dst 를 덮는다. */
function mergeInto_(dst, src) {
  Object.keys(src).forEach(function (k) {
    if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
      if (!dst[k]) dst[k] = {};
      mergeInto_(dst[k], src[k]);
    } else {
      dst[k] = src[k];
    }
  });
}

/** _출결_설정 시트를 key→value 객체로 읽는다 (6분 캐시). */
function getSettings_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('settings');
  if (hit) return JSON.parse(hit);

  var sh = sheet_(APP_SHEET.설정, true);
  var out = {};
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
      if (r[0] !== '' && r[0] != null) out[String(r[0])] = r[1];
    });
  }
  cache.put('settings', JSON.stringify(out), 360);
  return out;
}

/**
 * 설정 하나를 읽는다.
 * @param {string} key
 * @param {*=} fallback 시트에 값이 없을 때 쓸 값. 없으면 SETTING_DEFAULTS 를 쓴다.
 */
function setting_(key, fallback) {
  var v = getSettings_()[key];
  if (v === undefined || v === '' || v === null) {
    if (fallback !== undefined) return fallback;
    return SETTING_DEFAULTS[key] ? SETTING_DEFAULTS[key][0] : '';
  }
  return v;
}

/** 정수 설정. 값이 이상하면 기본값으로 떨어진다. */
function settingInt_(key) {
  var n = parseInt(setting_(key), 10);
  if (!isNaN(n)) return n;
  return parseInt(SETTING_DEFAULTS[key][0], 10);
}

/** 불리언 설정 */
function settingBool_(key) {
  var v = setting_(key);
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/**
 * 웹앱 주소를 알아낸다.
 *
 * ScriptApp.getService().getUrl() 을 그대로 쓰면 안 된다. 메뉴처럼 편집기 쪽에서
 * 부르면 배포 주소(/exec)가 아니라 개발 주소(/dev)를 돌려준다. /dev 는 스크립트
 * 편집 권한이 있는 계정에서만 열려서, 태블릿에서는 물론이고 구글 계정이 여러 개
 * 로그인돼 있으면 본인 PC 에서도 열리지 않는다.
 *
 * 그래서 배포 주소를 _출결_설정에 적어두고 그 값을 우선한다.
 *
 * @return {{url: string, source: string}} source 는 setting | dev | exec | none
 */
function webAppUrl_() {
  var saved = String(setting_('웹앱주소', '') || '').trim();
  if (saved) return { url: saved, source: 'setting' };

  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { url = ''; }
  if (!url) return { url: '', source: 'none' };
  return { url: url, source: /\/dev\/?$/.test(url) ? 'dev' : 'exec' };
}

/** 설정 캐시를 버린다. 값을 바꾼 뒤 반드시 호출한다. */
function clearSettingsCache_() {
  CacheService.getScriptCache().remove('settings');
}

/**
 * 기본정보 시트에서 학원명을 읽는다.
 * "학원명" 라벨을 찾아 바로 아래 셀을 쓴다.
 */
function getAcademyName_() {
  var sh = sheet_(SHEET.기본정보, true);
  if (!sh) return '학원';

  var rows = Math.min(sh.getLastRow(), 30);
  var cols = Math.min(sh.getLastColumn(), 8);
  if (rows < 2 || cols < 1) return '학원';

  var values = sh.getRange(1, 1, rows, cols).getValues();
  for (var r = 0; r < values.length - 1; r++) {
    for (var c = 0; c < values[r].length; c++) {
      if (String(values[r][c]).trim() === '학원명') {
        var name = String(values[r + 1][c]).trim();
        if (name) return name;
      }
    }
  }
  return '학원';
}
