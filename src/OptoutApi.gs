/**
 * OptoutApi.gs — 보호자 수신거부.
 *
 * 알림톡 하단 버튼의 링크로 들어온다. 링크에 학생을 가리키는 서명된 키가
 * 실려 있어서 "누구세요" 를 되물을 필요가 없다.
 *
 * 봇 키워드로는 이걸 못 한다. 카카오가 스킬 서버에 넘겨주는 건 채널 전용
 * 익명 ID 라, 그 사람이 어느 학생의 보호자인지 알 방법이 없다.
 *
 * 여기서 끄는 것은 _출결_학생의 알림수신 한 칸이다. 이게 꺼지면 알림톡도
 * SMS 도 나가지 않는다. 보호자가 채널을 차단하는 것과는 다르다 —
 * 차단만 하면 알림톡이 실패해 SMS 폴백으로 오히려 계속 간다.
 */

/** 서명 길이. 20자면 위조 시도로는 뚫을 수 없고 주소도 짧다. */
var OPTOUT_SIG_LEN = 20;

/** 서명에 쓰는 비밀값. 없으면 만들어 둔다. */
function optoutSalt_() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty(SECRET_KEY.optoutSalt);
  if (!salt) {
    salt = Utilities.getUuid();
    props.setProperty(SECRET_KEY.optoutSalt, salt);
  }
  return salt;
}

function optoutSig_(studentId) {
  var raw = Utilities.computeHmacSha256Signature(String(studentId), optoutSalt_());
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('').slice(0, OPTOUT_SIG_LEN);
}

/**
 * 알림톡 버튼 링크에 실을 키. 'S001.9f3c…' 모양이다.
 *
 * 학생ID 만 실으면 S002 로 고쳐 남의 알림을 끌 수 있다.
 * 그래서 서명을 붙인다.
 */
function optoutKey_(studentId) {
  var id = str_(studentId);
  if (!id) return '';
  return id + '.' + optoutSig_(id);
}

/**
 * 키에서 학생ID 를 꺼낸다. 서명이 맞지 않으면 빈 문자열.
 * @return {string}
 */
function verifyOptoutKey_(key) {
  var s = str_(key);
  var i = s.lastIndexOf('.');
  if (i <= 0) return '';

  var id = s.slice(0, i);
  var sig = s.slice(i + 1);
  if (!id || sig.length !== OPTOUT_SIG_LEN) return '';
  if (sig !== optoutSig_(id)) return '';
  return id;
}

/**
 * 알림톡 버튼에 등록할 링크.
 *
 * 심사에는 이 모양 그대로 올린다. #{수신거부키} 는 발송할 때 채워진다.
 * 버튼도 심사 대상이라 나중에 붙이려면 재심사를 받아야 한다.
 */
function optoutLinkTemplate_() {
  var base = webAppUrl_().url;
  if (!base) return '';
  return base + (base.indexOf('?') === -1 ? '?' : '&') + 'page=optout&k=#{수신거부키}';
}

/**
 * 변수를 못 쓰는 대행사용 고정 링크.
 * 이 주소로 들어오면 화면이 이름·연락처를 물어 본인을 확인한다.
 */
function optoutFixedLink_() {
  var base = webAppUrl_().url;
  if (!base) return '';
  return base + (base.indexOf('?') === -1 ? '?' : '&') + 'page=optout';
}

/** 학생ID 로 학생 한 명을 찾는다. */
function findStudentById_(studentId) {
  var students = readStudents_();
  for (var i = 0; i < students.length; i++) {
    if (students[i].학생ID === studentId) return students[i];
  }
  return null;
}

/* ── 화면이 부르는 것들 ──────────────────────────────────────────── */

/**
 * 이름과 보호자 연락처로 학생을 찾는다.
 *
 * 알림톡 버튼 링크에 변수를 못 넣는 대행사가 있다. 그때는 고정 링크로 들어와
 * 여기서 본인을 확인한다. 이름만으로는 안 되고 연락처가 함께 맞아야 한다.
 *
 * @return {{ok, students, message}}
 */
function findByNameAndPhone_(name, phone) {
  var n = str_(name).replace(/\s/g, '');
  var p = normalizePhone_(phone);

  if (!n) return { ok: false, students: [], message: '학생 이름을 입력해주세요.' };
  if (!p) return { ok: false, students: [], message: '연락처를 다시 확인해주세요.' };

  var hit = readStudents_().filter(function (s) {
    if (normalizePhone_(s.보호자연락처) !== p) return false;
    var display = str_(s.표시명 || s.이름).replace(/\s/g, '');
    var real = str_(s.이름).replace(/\s/g, '');
    return display === n || real === n;
  });

  if (!hit.length) {
    // 어느 쪽이 틀렸는지 알려주지 않는다. 이름을 넣어보며 번호를 캐낼 수 있다.
    return {
      ok: false,
      students: [],
      message: '학생 이름과 연락처가 맞지 않습니다. 학원에 등록된 정보와 같은지 확인해주세요.'
    };
  }
  return { ok: true, students: hit, message: '' };
}

/**
 * 수신거부 화면이 처음 뜰 때.
 *
 * 키가 없으면(고정 링크로 들어오면) 본인 확인 화면을 띄우라고 알려준다.
 *
 * @return {{ok, needsLookup, name, receiving, academy, message}}
 */
function optoutBootstrap(key) {
  applyProbedLayout_();

  var base = { academy: getAcademyName_() };

  if (!str_(key)) {
    base.ok = false;
    base.needsLookup = true;
    base.message = '학생 이름과 학원에 등록된 보호자 연락처를 입력해주세요.';
    return base;
  }

  var id = verifyOptoutKey_(key);
  if (!id) {
    base.ok = false;
    base.needsLookup = true;
    base.message = '주소가 올바르지 않습니다. 아래에서 직접 확인해주세요.';
    return base;
  }

  var student = findStudentById_(id);
  if (!student) {
    base.ok = false;
    base.message = '학생 정보를 찾을 수 없습니다. 학원으로 문의해주세요.';
    return base;
  }

  base.ok = true;
  base.name = student.표시명 || student.이름;
  base.receiving = !!student.알림수신;
  return base;
}

/**
 * 이름·연락처로 찾아 그 학생의 키를 돌려준다.
 *
 * 여기서부터는 키가 있는 경우와 똑같은 길을 탄다.
 * 형제자매가 같은 번호를 쓰면 여러 명이 나오므로 목록으로 준다.
 *
 * @return {{ok, students: [{key, name, receiving}], message}}
 */
function optoutLookup(name, phone) {
  applyProbedLayout_();

  var found = findByNameAndPhone_(name, phone);
  if (!found.ok) return { ok: false, students: [], message: found.message };

  return {
    ok: true,
    students: found.students.map(function (s) {
      return {
        key: optoutKey_(s.학생ID),
        name: s.표시명 || s.이름,
        receiving: !!s.알림수신
      };
    }),
    message: ''
  };
}

/**
 * 알림 수신 여부를 바꾼다.
 *
 * @param {string} key     버튼 링크에 실린 서명 키 (조회로 받은 키도 같다)
 * @param {boolean} receive true 면 다시 받기, false 면 그만 받기
 */
function optoutSet(key, receive) {
  applyProbedLayout_();

  var id = verifyOptoutKey_(key);
  if (!id) return { ok: false, message: '주소가 올바르지 않습니다.' };

  var want = (receive === true);

  return withLock_(function () {
    var student = findStudentById_(id);
    if (!student) return { ok: false, message: '학생 정보를 찾을 수 없습니다.' };

    var before = !!student.알림수신;
    var name = student.표시명 || student.이름;

    if (before === want) {
      return { ok: true, receiving: want, name: name, message: '이미 그렇게 설정되어 있습니다.' };
    }

    updateStudentCell_(student.행, STUDENT_COL.알림수신, want);
    clearRosterCache_();

    appendHistory_({
      대상기록ID: '',
      작업: want ? '수신재개' : '수신거부',
      필드: '알림수신',
      이전값: before ? 'TRUE' : 'FALSE',
      이후값: want ? 'TRUE' : 'FALSE',
      수행자: '보호자(알림 링크)',
      사유: name + ' 보호자가 알림 메시지 버튼으로 직접 변경'
    });

    return {
      ok: true,
      receiving: want,
      name: name,
      message: want
        ? '출결 알림을 다시 보내드립니다.'
        : '앞으로 출결 알림을 보내지 않습니다.'
    };
  }, 15000);
}
