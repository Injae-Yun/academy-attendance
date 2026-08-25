/**
 * Auth.gs — 기기 등록과 인증.
 *
 * 일반 Gmail 계정이라 웹앱을 "링크가 있는 모든 사용자" 로 배포할 수밖에 없다.
 * 그래서 구글 로그인 대신 앱 레벨 인증을 둔다.
 *
 *   최초 접속 → 관리자 PIN → 별명 + 모드 선택 → 토큰 발급 → localStorage 저장
 *   이후 모든 요청에 토큰을 동봉하고 서버가 _출결_기기 시트와 대조한다.
 *
 * 분실한 태블릿은 시트에서 활성을 FALSE 로 바꾸면 즉시 차단된다.
 */

/** 관리자 PIN 이 맞는지 확인한다. 평문은 어디에도 저장하지 않는다. */
function verifyAdminPin_(pin) {
  var p = str_(pin);
  if (!p) return false;

  var hash = str_(setting_('관리자PIN해시'));
  if (!hash) {
    throw new Error(
      '관리자 PIN 이 아직 설정되지 않았습니다. ' +
      'Apps Script 편집기에서 setAdminPin(\'원하는PIN\') 을 실행해주세요.'
    );
  }
  var salt = PropertiesService.getScriptProperties().getProperty(SECRET_KEY.adminPinSalt);
  return hashPin_(p, salt) === hash;
}

/**
 * 토큰으로 기기를 확인한다.
 * @return {{ok: boolean, mode: string, label: string, reason: string}}
 */
function verifyDevice_(token) {
  var t = str_(token);
  if (!t) return { ok: false, mode: '', label: '', reason: '기기가 등록되지 않았습니다.' };

  var devices = readDevices_();
  for (var i = 0; i < devices.length; i++) {
    if (devices[i].토큰 !== t) continue;
    if (!devices[i].활성) {
      return { ok: false, mode: '', label: devices[i].별명, reason: '사용이 중지된 기기입니다.' };
    }
    return { ok: true, mode: devices[i].모드, label: devices[i].별명, reason: '', 행: devices[i].행 };
  }
  return { ok: false, mode: '', label: '', reason: '등록되지 않은 기기입니다. 다시 등록해주세요.' };
}

/**
 * 새 기기를 등록하고 토큰을 발급한다.
 *
 * @param {string} pin 관리자 PIN
 * @param {string} label 기기 별명 (예: 현관 태블릿)
 * @param {string} mode 'kiosk' 또는 'staff'
 * @return {{ok: boolean, token: string, mode: string, message: string}}
 */
function registerDevice(pin, label, mode) {
  applyProbedLayout_();

  var name = str_(label) || '이름 없는 기기';
  var m = (mode === MODE.직원) ? MODE.직원 : MODE.키오스크;

  try {
    if (!verifyAdminPin_(pin)) {
      return { ok: false, token: '', mode: '', message: '관리자 PIN 이 올바르지 않습니다.' };
    }
  } catch (e) {
    return { ok: false, token: '', mode: '', message: e.message };
  }

  return withLock_(function () {
    var token = Utilities.getUuid();
    appendDevice_(token, name, m);
    appendHistory_({
      대상기록ID: token.slice(0, 8),
      작업: '기기등록',
      필드: '모드',
      이전값: '',
      이후값: m === MODE.키오스크 ? '키오스크' : '직원',
      수행자: name,
      사유: '관리자 PIN 확인 후 등록'
    });
    return {
      ok: true,
      token: token,
      mode: m,
      message: '"' + name + '" 을(를) ' +
        (m === MODE.키오스크 ? '키오스크' : '직원') + ' 모드로 등록했습니다.'
    };
  });
}

/**
 * 요청마다 토큰을 검사한다. 실패하면 오류를 던진다.
 * @return {{mode: string, label: string, 행: number}}
 */
function requireDevice_(token) {
  var d = verifyDevice_(token);
  if (!d.ok) {
    var err = new Error(d.reason);
    err.needsRegister = true;
    throw err;
  }
  return d;
}

/* ── 관리자 잠금 해제 ─────────────────────────────────────────────── */

/**
 * 관리자 티켓 유효 시간(분).
 * 현관 태블릿이 해제된 채 방치되는 걸 막으려고 짧게 잡는다.
 */
var ADMIN_TICKET_MIN = 30;

/** 관리자 모드에서 허용하는 소급 범위(분). 400일치면 충분하다. */
var ADMIN_BACKDATE_MAX_MIN = 400 * 24 * 60;

/**
 * 관리자 PIN 을 확인하고 시한부 티켓을 발급한다.
 *
 * 소급 제한을 클라이언트에서만 풀면 주소를 아는 사람이 아무 시각이나
 * 보낼 수 있다. 그래서 서버가 티켓을 발급하고, 기록할 때마다
 * 그 티켓을 다시 검증한다.
 *
 * @return {{ok, ticket, minutes, message}}
 */
function unlockAdmin(token, pin) {
  applyProbedLayout_();

  var device;
  try {
    device = requireDevice_(token);
  } catch (e) {
    return { ok: false, needsRegister: true, message: e.message };
  }

  try {
    if (!verifyAdminPin_(pin)) {
      return { ok: false, message: '관리자 PIN 이 올바르지 않습니다.' };
    }
  } catch (e) {
    return { ok: false, message: e.message };
  }

  var ticket = Utilities.getUuid();
  var until = now_().getTime() + ADMIN_TICKET_MIN * 60000;

  // 만료 시각을 값에 같이 담는다. CacheService 는 남은 TTL 을 알려주지 않는데,
  // 태블릿에서 넘겨받은 티켓으로 관리자 화면을 열 때 남은 시간을 표시해야 한다.
  CacheService.getScriptCache()
    .put('adm|' + ticket, String(token) + '|' + until, ADMIN_TICKET_MIN * 60);

  appendHistory_({
    대상기록ID: '',
    작업: '관리자잠금해제',
    필드: '기기',
    이전값: '',
    이후값: device.label,
    수행자: device.label,
    사유: ADMIN_TICKET_MIN + '분간 소급 제한 해제'
  });

  return {
    ok: true,
    ticket: ticket,
    minutes: ADMIN_TICKET_MIN,
    until: until,
    message: ADMIN_TICKET_MIN + '분간 관리자 모드로 전환되었습니다.'
  };
}

/**
 * 티켓 하나를 읽는다.
 * @return {?{token: string, until: number}} 없으면 null
 */
function readAdminTicket_(ticket) {
  var t = str_(ticket);
  if (!t) return null;

  var raw = CacheService.getScriptCache().get('adm|' + t);
  if (!raw) return null;

  var parts = String(raw).split('|');
  return { token: parts[0], until: Number(parts[1]) || 0 };
}

/**
 * 관리자 티켓이 이 기기의 것으로 아직 살아 있는지 확인한다.
 * 티켓은 발급받은 기기에서만 쓸 수 있다.
 */
function verifyAdminTicket_(token, ticket) {
  var v = readAdminTicket_(ticket);
  if (!v) return false;
  if (v.token !== str_(token)) return false;

  // 캐시 만료를 기다리지 않고 우리가 먼저 자른다.
  if (v.until && v.until <= now_().getTime()) return false;
  return true;
}

/** 티켓이 언제까지 유효한가 (ms). 유효하지 않으면 0. */
function adminTicketUntil_(token, ticket) {
  if (!verifyAdminTicket_(token, ticket)) return 0;
  return readAdminTicket_(ticket).until;
}

/** 관리자 모드를 즉시 해제한다. */
function lockAdmin(ticket) {
  var t = str_(ticket);
  if (t) CacheService.getScriptCache().remove('adm|' + t);
  return { ok: true, message: '관리자 모드를 해제했습니다.' };
}
