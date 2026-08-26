/**
 * Attendance.gs — 출결 기록.
 *
 * 태블릿이 기다리지 않도록 여기서는 기록까지만 한다.
 * 발송은 로그에 '대기' 로 남기고 1분 주기 트리거가 배치로 처리한다.
 * 그래서 대행사 API 가 3초 걸려도 현관 줄이 밀리지 않는다.
 */

/* ── 오늘 현황 ────────────────────────────────────────────────────── */

/**
 * 오늘의 등·하원 시각을 학생별로 모은다. 명부 카드의 배지에 쓴다.
 * @return {Object} { 학생ID: { 등원: 'HH:mm', 하원: 'HH:mm' } }
 */
function getTodayAttendance_() {
  var today = fmtDate_(now_());
  var cache = CacheService.getScriptCache();
  var hit = cache.get('today|' + today);
  if (hit) return JSON.parse(hit);

  var out = {};
  readLogs_().forEach(function (r) {
    if (!r.출결시각 || fmtDate_(r.출결시각) !== today) return;
    if (r.상태 === LOGST.취소됨) return;
    if (!out[r.학생ID]) out[r.학생ID] = {};
    out[r.학생ID][r.구분] = fmtTime_(r.출결시각);
  });

  cache.put('today|' + today, JSON.stringify(out), 120);
  return out;
}

/** 오늘 현황 캐시를 버린다. 기록·수정 후 호출한다. */
function clearTodayCache_() {
  CacheService.getScriptCache().remove('today|' + fmtDate_(now_()));
}

/* ── 앱 부트스트랩 ────────────────────────────────────────────────── */

/**
 * 앱이 처음 뜰 때 필요한 것을 한 번에 내려준다.
 * 왕복을 줄이려고 명부·오늘현황·설정을 묶었다.
 *
 * @param {string} token 기기 토큰 (없으면 등록 화면용 응답)
 */
function getBootstrap(token) {
  applyProbedLayout_();

  var base = {
    academy: getAcademyName_(),
    serverTime: fmtStamp_(now_()),
    today: fmtDate_(now_())
  };

  var d = verifyDevice_(token);
  if (!d.ok) {
    base.needsRegister = true;
    base.reason = d.reason;
    return base;
  }

  var roster = getRoster();
  base.needsRegister = false;
  base.device = { mode: d.mode, label: d.label };
  base.roster = roster.students;
  base.rosterVersion = roster.version;
  base.attendance = getTodayAttendance_();
  base.limits = {
    소급최대분: settingInt_('소급최대분'),
    중복차단분: settingInt_('중복차단분'),
    단위분: 5,
    관리자유효분: ADMIN_TICKET_MIN
  };
  try { touchDevice_(d.행); } catch (e) { /* 마지막 사용 기록 실패는 무시한다 */ }
  return base;
}

/* ── 기록 ─────────────────────────────────────────────────────────── */

/**
 * 출결을 기록한다.
 *
 * @param {Object} req
 *   token      기기 토큰
 *   studentId  학생ID
 *   kind       '등원' | '하원'
 *   atIso      출결시각 (ISO 문자열). 없으면 지금
 *   pin        키오스크 모드에서 학생 PIN
 *   force      중복 확인을 건너뛴다 (오프라인 큐처럼 이미 확인을 거친 경우)
 *   replaceId  이 기록ID 를 새 값으로 덮어쓴다. 중복 확인에서 받은 값을 그대로 돌려준다.
 *              없으면 새 줄을 남긴다.
 * @return {Object} ok / needsConfirm / message ...
 */
function recordAttendance(req) {
  applyProbedLayout_();
  req = req || {};

  var device;
  try {
    device = requireDevice_(req.token);
  } catch (e) {
    return { ok: false, needsRegister: true, message: e.message };
  }

  var kind = (req.kind === KIND.하원) ? KIND.하원 : KIND.등원;
  var enteredAt = now_();
  var at = req.atIso ? toDate_(req.atIso) : enteredAt;
  if (!at) return { ok: false, message: '출결 시각을 해석할 수 없습니다.' };
  if (req.atIso) {
    // ISO 문자열은 초 단위까지 오므로 분 단위로 맞춘다
    at = new Date(at.getTime());
    at.setSeconds(0, 0);
  }

  // 관리자 티켓이 살아 있으면 소급 제한을 푼다.
  // 태블릿이 고장 나 며칠치를 몰아 넣어야 할 때가 있는데,
  // 120분 제한이면 손도 댈 수 없다.
  var isAdmin = verifyAdminTicket_(req.token, req.adminTicket);
  var maxBack = isAdmin ? ADMIN_BACKDATE_MAX_MIN : settingInt_('소급최대분');

  // 미래는 관리자라도 막는다. 아직 오지 않은 출결은 기록할 수 없다.
  var check = validateAttendTime_(at, enteredAt, maxBack);
  if (!check.ok) return { ok: false, message: check.reason };

  return withLock_(function () {
    var students = readStudents_();
    var student = null;
    for (var i = 0; i < students.length; i++) {
      if (students[i].학생ID === req.studentId) { student = students[i]; break; }
    }
    if (!student) return { ok: false, message: '학생을 찾을 수 없습니다. 명부를 새로고침해주세요.' };
    // 휴원생도 기록할 수 있게 둔다. 복귀 첫날에 막히면 곤란하다.
    // 퇴소·확인필요는 막는다.
    if (student.상태 !== ST.재원 && student.상태 !== ST.휴원) {
      return {
        ok: false,
        message: '"' + (student.표시명 || student.이름) + '" 은(는) 현재 ' +
          student.상태 + ' 상태라 기록할 수 없습니다.'
      };
    }

    // 키오스크 모드에서 PIN 이 설정된 학생은 본인 확인을 거친다
    if (device.mode === MODE.키오스크 && student.PIN) {
      if (str_(req.pin) !== student.PIN) {
        return { ok: false, needsPin: true, message: 'PIN 이 올바르지 않습니다.' };
      }
    }

    // 중복 방지 — 같은 학생·같은 구분을 짧은 시간 안에 다시 누른 경우
    var blockMin = settingInt_('중복차단분');
    var logs = readLogs_();
    if (!req.force) {
      for (var j = logs.length - 1; j >= 0; j--) {
        var prev = logs[j];
        if (prev.학생ID !== student.학생ID) continue;
        if (prev.구분 !== kind) continue;
        if (prev.상태 === LOGST.취소됨) continue;
        if (!prev.출결시각) continue;
        // 과목이 겹치지 않으면 다른 수업이므로 중복이 아니다
        if (!subjectsOverlap_(prevSubjects_(prev), req.subjects, student)) continue;
        var gap = Math.abs(diffMinutes_(at, prev.출결시각));
        if (gap <= blockMin) {
          // 새 줄을 만들지 않고 그 기록을 고칠 것이므로, 어느 기록인지 알려준다.
          // 확인을 누르면 이 기록ID 를 replaceId 로 되돌려 보낸다.
          return {
            ok: false,
            needsConfirm: true,
            replaceId: prev.기록ID,
            message: '이미 ' + fmtTime_(prev.출결시각) + '에 ' + kind +
              ' 기록이 있습니다. ' +
              (fmtTime_(prev.출결시각) === fmtTime_(at)
                ? '같은 시각으로 다시 기록할까요?'
                : fmtTime_(at) + ' 로 고칠까요?')
          };
        }
        break;
      }
    }

    var display = student.표시명 || student.이름;

    // 중복 확인에서 "고칠까요?" 에 확인을 누른 경우.
    // 새 줄을 만들면 목록에 잘못된 기록이 그대로 남는다. 그 줄을 고치고
    // 고쳤다는 사실은 _출결_이력에 남긴다.
    var replacing = req.replaceId ? findReplaceTarget_(logs, req.replaceId, student, kind) : null;
    var recordId = replacing ? replacing.기록ID : nextLogId_(logs);

    // 복수 과목 학생이 어떤 수업으로 왔는지 고른 값.
    // 안 고르면 그 학생의 모든 과목으로 본다.
    var all = splitSubjects_(student.과목).filter(function (x) { return !!x; });
    var picked = normalizeSubjectFilter_(req.subjects).filter(function (x) {
      return all.indexOf(x) !== -1;
    });
    if (all.length > 1 && !picked.length) picked = all.slice();
    var subjectText = (all.length > 1) ? picked.join(',') : '';

    // 발송 조건을 미리 정해 둔다 (실제 발송은 트리거가 한다)
    var sendState = SENDST.대기;
    if (!student.알림수신) sendState = SENDST.수신거부;
    else if (!student.보호자연락처) sendState = SENDST.번호없음;
    else if (isAdmin && req.notify !== true) {
      // 소급 기록은 기본적으로 보내지 않는다.
      // 월요일에 금요일 출결을 넣으면서 사흘 지난 알림을 보내면
      // 보호자만 혼란스럽다. 필요하면 앱에서 켜서 보낼 수 있다.
      sendState = SENDST.관리자;
    }

    if (replacing) {
      supersedeLog_(replacing, {
        at: at,
        enteredAt: enteredAt,
        subjects: picked,
        subjectText: subjectText,
        sendState: sendState,
        device: device,
        note: buildNote_(req, isAdmin, at, enteredAt)
      });
    } else {
      appendLog_({
        기록ID: recordId,
        입력시각: enteredAt,      // 실제로 탭한 시각
        출결시각: at,             // 사용자가 고른 시각 (5분 조정 반영)
        학생ID: student.학생ID,
        이름: display,
        구분: kind,
        상태: LOGST.정상,
        기기: device.label,
        발송상태: sendState,
        과목: subjectText,
        비고: buildNote_(req, isAdmin, at, enteredAt)
      });
    }

    // 등원이면 원장(그리고 같은 달을 보고 있으면 출석부)에 O 를 찍는다
    var markInfo = { ledger: 0, book: 0, rowFound: 0, alreadyMarked: false, skipped: '' };
    if (kind === KIND.등원) {
      try {
        markInfo = markAttendance_(display, at, MARK.출석, picked);
      } catch (e) {
        markInfo.skipped = '출석부 기입 실패: ' + e.message;
      }
      // 원래 사유(중복 확인 등)를 지우지 않고 덧붙인다
      if (markInfo.skipped) {
        var logRow = findLogRow_(recordId);
        if (logRow) {
          var prefix = buildNote_(req, isAdmin, at, enteredAt);
          var note = prefix ? prefix + ' · ' + markInfo.skipped : markInfo.skipped;
          updateLogCells_(logRow, keyValue_(LOG_COL.비고, note));
        }
      }
    }

    clearTodayCache_();

    return {
      ok: true,
      recordId: recordId,
      studentId: student.학생ID,
      name: display,
      kind: kind,
      at: fmtTime_(at),
      enteredAt: fmtTime_(enteredAt),
      adjusted: fmtTime_(at) !== fmtTime_(enteredAt),
      send: sendState,
      mark: markInfo,
      admin: isAdmin,
      subjects: picked,
      notified: sendState === SENDST.대기,
      replaced: !!replacing,
      date: fmtDate_(at),
      message: display + ' ' + kind + ' ' + fmtTime_(at) +
        (replacing ? ' (수정)' : '')
    };
  }, 30000);
}

/** 옛 로그의 과목 목록. 값이 없으면 그 학생의 전체 과목으로 본다. */
function prevSubjects_(log) {
  return normalizeSubjectFilter_(log.과목);
}

/**
 * 두 과목 선택이 겹치는지.
 * 한쪽이라도 비어 있으면 "전부" 를 뜻하므로 겹치는 것으로 본다.
 */
function subjectsOverlap_(a, b, student) {
  var listA = normalizeSubjectFilter_(a);
  var listB = normalizeSubjectFilter_(b);
  if (!listA.length || !listB.length) return true;
  for (var i = 0; i < listA.length; i++) {
    if (listB.indexOf(listA[i]) !== -1) return true;
  }
  return false;
}

/**
 * 로그 비고를 만든다.
 * 나중에 왜 이 기록이 이렇게 들어갔는지 알 수 있어야 한다.
 */
function buildNote_(req, isAdmin, at, enteredAt) {
  var parts = [];
  if (req.force) parts.push('중복 확인 후 기록');
  if (isAdmin && req.notify !== true) parts.push('알림 미발송');
  if (isAdmin && fmtDate_(at) !== fmtDate_(enteredAt)) {
    parts.push('관리자 소급 기록 (' + fmtDate_(at) + ')');
  } else if (isAdmin && diffMinutes_(enteredAt, at) > settingInt_('소급최대분')) {
    parts.push('관리자 소급 기록');
  }
  return parts.join(' · ');
}

/**
 * 덮어쓸 기록을 찾는다.
 *
 * 조건이 하나라도 어긋나면 null 을 돌려 평소처럼 새 줄을 남긴다.
 * 엉뚱한 기록을 덮어쓰는 것보다 줄이 하나 더 생기는 편이 낫다.
 */
function findReplaceTarget_(logs, recordId, student, kind) {
  for (var i = 0; i < logs.length; i++) {
    var r = logs[i];
    if (r.기록ID !== str_(recordId)) continue;
    if (r.학생ID !== student.학생ID) return null;
    if (r.구분 !== kind) return null;
    if (r.상태 === LOGST.취소됨) return null;
    return r;
  }
  return null;
}

/**
 * 기록 한 줄을 새 값으로 덮어쓴다.
 *
 * 잘못 찍힌 기록이 목록에 남아 있으면 어느 쪽이 맞는지 알 수 없다.
 * 줄은 하나만 두고, 무엇이 어떻게 바뀌었는지는 _출결_이력에 남긴다.
 *
 * @param {Object} target 덮어쓸 로그 (readLogs_ 가 준 행)
 * @param {Object} next   { at, enteredAt, subjectText, sendState, device, note }
 */
function supersedeLog_(target, next) {
  var beforeAt = fmtStamp_(target.출결시각);
  var beforeSubjects = normalizeSubjectFilter_(target.과목);
  var afterSubjects = normalizeSubjectFilter_(next.subjectText);

  // 등원이면 옛 O 를 걷어낸다. 날짜와 과목이 그대로면 건드릴 이유가 없다.
  // 새 O 는 이 함수를 부른 쪽에서 찍는다.
  if (target.구분 === KIND.등원) {
    var dayChanged = fmtDate_(target.출결시각) !== fmtDate_(next.at);
    var subjChanged = beforeSubjects.join(',') !== afterSubjects.join(',');

    if (dayChanged || subjChanged) {
      // 같은 날 · 같은 과목의 다른 등원이 남아 있으면 O 는 그대로 둔다
      var day = fmtDate_(target.출결시각);
      var others = readLogs_().filter(function (r) {
        if (r.기록ID === target.기록ID) return false;
        if (r.학생ID !== target.학생ID) return false;
        if (r.구분 !== KIND.등원) return false;
        if (r.상태 === LOGST.취소됨) return false;
        if (!r.출결시각 || fmtDate_(r.출결시각) !== day) return false;
        return subjectsOverlap_(normalizeSubjectFilter_(r.과목), beforeSubjects);
      });

      if (!others.length) {
        // 출석부를 못 건드려도 로그 수정은 진행한다.
        // 여기서 멈추면 시각이 틀린 채로 남는다.
        try {
          unmarkAttendance_(target.이름, target.출결시각, MARK.출석, beforeSubjects);
        } catch (e) { /* 무시 */ }
      }
    }
  }

  var patch = {};
  patch[LOG_COL.입력시각] = fmtStamp_(next.enteredAt);
  patch[LOG_COL.출결시각] = fmtStamp_(next.at);
  patch[LOG_COL.상태] = LOGST.수정됨;
  patch[LOG_COL.기기] = next.device.label;
  patch[LOG_COL.과목] = next.subjectText;
  patch[LOG_COL.비고] = next.note;
  updateLogCells_(target.행, patch);

  // 아직 안 나간 알림은 새 시각으로 나가야 한다.
  // 이미 나갔으면 그대로 둔다 — 보호자에게 같은 내용이 두 번 갈 이유가 없다.
  if (target.발송상태 === SENDST.대기) {
    markSendResult_(target.행, next.sendState, '', '', '');
  }

  appendHistory_({
    대상기록ID: target.기록ID,
    작업: '재기록',
    필드: '출결시각',
    이전값: beforeAt,
    이후값: fmtStamp_(next.at),
    수행자: next.device.label,
    사유: '앱에서 같은 구분을 다시 눌러 덮어씀'
  });
}

/** 기록ID 로 로그 행 번호를 찾는다. */
function findLogRow_(recordId) {
  var logs = readLogs_();
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].기록ID === recordId) return logs[i].행;
  }
  return 0;
}

/** {열번호: 값} 객체를 만든다. 열 상수를 키로 쓰기 위한 도우미. */
function keyValue_(col, value) {
  var o = {};
  o[col] = value;
  return o;
}

/**
 * 오프라인 큐를 한꺼번에 올린다.
 * 태블릿이 네트워크를 잃었다가 복구했을 때 쓴다.
 *
 * @param {string} token
 * @param {Array} items recordAttendance 의 req 와 같은 형태 (token 제외)
 * @return {{results: Array}}
 */
function recordAttendanceBatch(token, items) {
  var out = [];
  (items || []).forEach(function (it) {
    it.token = token;
    it.force = true;   // 이미 태블릿에서 확인을 거친 항목이다
    try {
      out.push(recordAttendance(it));
    } catch (e) {
      out.push({ ok: false, message: e.message, clientId: it.clientId });
    }
    if (out.length && it.clientId) out[out.length - 1].clientId = it.clientId;
  });
  return { results: out };
}

/** 명부와 오늘 현황만 다시 받는다 (앱 새로고침용). */
function refreshRoster(token) {
  applyProbedLayout_();
  try {
    requireDevice_(token);
  } catch (e) {
    return { ok: false, needsRegister: true, message: e.message };
  }
  clearRosterCache_();
  clearTodayCache_();
  var roster = getRoster();
  return {
    ok: true,
    roster: roster.students,
    rosterVersion: roster.version,
    attendance: getTodayAttendance_(),
    serverTime: fmtStamp_(now_())
  };
}

/** 앱에서 보호자 연락처를 입력할 때. 토큰 검사를 덧붙인다. */
function saveGuardianPhoneFromApp(token, studentId, phone) {
  try {
    requireDevice_(token);
  } catch (e) {
    return { ok: false, needsRegister: true, message: e.message };
  }
  var res = saveGuardianPhone(studentId, phone);
  if (res.ok) clearTodayCache_();
  return res;
}
