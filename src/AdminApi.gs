/**
 * Admin.gs — 관리자 화면의 서버 로직.
 *
 * 잘못 찍힌 기록을 고치는 곳이다. 세 가지를 지킨다.
 *
 *   1) 물리 삭제하지 않는다. 취소는 상태만 '취소됨' 으로 바꾼다.
 *   2) 모든 변경에 사유를 받는다. 나중에 왜 고쳤는지 알 수 있어야 한다.
 *   3) 출석부의 O 도 함께 되돌린다. 로그만 고치면 두 곳이 어긋난다.
 *
 * 인증은 태블릿과 같은 방식이다. 기기 토큰 + 관리자 티켓을 함께 본다.
 */

/* ── 인증 ─────────────────────────────────────────────────────────── */

/**
 * 관리자 화면의 모든 요청은 이걸 거친다.
 * 기기 토큰만으로는 부족하고 관리자 티켓이 살아 있어야 한다.
 */
function requireAdmin_(token, ticket) {
  var device = requireDevice_(token);
  if (!verifyAdminTicket_(token, ticket)) {
    var err = new Error('관리자 인증이 만료되었습니다. PIN 을 다시 입력해주세요.');
    err.needsUnlock = true;
    throw err;
  }
  return device;
}

/** 관리자 화면 부팅 — 인증 상태와 요약을 함께 내려준다. */
function adminBootstrap(token, ticket) {
  applyProbedLayout_();

  var base = {
    academy: getAcademyName_(),
    serverTime: fmtStamp_(now_()),
    today: fmtDate_(now_())
  };

  var device = verifyDevice_(token);
  if (!device.ok) {
    base.needsRegister = true;
    base.reason = device.reason;
    return base;
  }
  base.device = { mode: device.mode, label: device.label };

  if (!verifyAdminTicket_(token, ticket)) {
    base.needsUnlock = true;
    base.minutes = ADMIN_TICKET_MIN;
    return base;
  }

  base.needsUnlock = false;
  base.minutes = ADMIN_TICKET_MIN;
  // 태블릿에서 티켓을 넘겨받아 들어온 경우, 남은 시간을 여기서 알려줘야
  // 상단 카운트다운이 0 분으로 시작해 곧바로 잠기는 일이 없다.
  //
  // 만료 시각이 아니라 '남은 밀리초' 로 준다. 태블릿 시계가 서버와 어긋나 있어도
  // 남은 시간은 그대로 맞다.
  base.ticketLeftMs = Math.max(0, adminTicketUntil_(token, ticket) - now_().getTime());
  base.summary = adminSummary_();
  return base;
}

/**
 * 상단에 상시 띄울 배지.
 * 조용히 쌓이면 놓치는 것들만 골라 센다.
 */
function adminSummary_() {
  var logs = readLogs_();
  var students = readStudents_();

  var 재원 = students.filter(function (s) { return s.상태 === ST.재원; });
  return {
    발송실패: logs.filter(function (r) { return r.발송상태 === SENDST.실패; }).length,
    발송대기: logs.filter(function (r) { return r.발송상태 === SENDST.대기; }).length,
    연락처미등록: 재원.filter(function (s) { return !s.보호자연락처; }).length,
    출석부미매핑: 재원.filter(function (s) { return !s.출석부행; }).length,
    확인필요: students.filter(function (s) { return s.상태 === ST.확인필요; }).length
  };
}

/* ── 조회 ─────────────────────────────────────────────────────────── */

/**
 * 하루치 출결을 시각 순으로 돌려준다.
 * @param {string} dateStr 'yyyy-MM-dd'
 */
function adminListDay(token, ticket, dateStr) {
  applyProbedLayout_();
  try {
    requireAdmin_(token, ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }

  var target = str_(dateStr) || fmtDate_(now_());
  var rows = readLogs_().filter(function (r) {
    return r.출결시각 && fmtDate_(r.출결시각) === target;
  });

  rows.sort(function (a, b) {
    return a.출결시각.getTime() - b.출결시각.getTime();
  });

  return {
    ok: true,
    date: target,
    records: rows.map(function (r) {
      return {
        id: r.기록ID,
        studentId: r.학생ID,
        name: r.이름,
        kind: r.구분,
        at: fmtTime_(r.출결시각),
        enteredAt: r.입력시각 ? fmtTime_(r.입력시각) : '',
        adjusted: !!(r.입력시각 && fmtTime_(r.출결시각) !== fmtTime_(r.입력시각)),
        status: r.상태,
        send: r.발송상태,
        channel: r.발송채널,
        error: r.오류,
        subject: r.과목,
        device: r.기기,
        note: r.비고
      };
    })
  };
}

/** 수정 이력 최근 N 건 */
function adminHistory(token, ticket, limit) {
  applyProbedLayout_();
  try {
    requireAdmin_(token, ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }

  var sh = sheet_(APP_SHEET.이력, true);
  if (!sh) return { ok: true, items: [] };

  var rows = readRows_(sh, 2, HISTORY_HEADERS.length);
  var items = [];
  rows.forEach(function (row) {
    if (!str_(cell_(row, HISTORY_COL.이력ID))) return;
    items.push({
      at: str_(cell_(row, HISTORY_COL.시각)),
      target: str_(cell_(row, HISTORY_COL.대상기록ID)),
      action: str_(cell_(row, HISTORY_COL.작업)),
      field: str_(cell_(row, HISTORY_COL.필드)),
      before: str_(cell_(row, HISTORY_COL.이전값)),
      after: str_(cell_(row, HISTORY_COL.이후값)),
      by: str_(cell_(row, HISTORY_COL.수행자)),
      reason: str_(cell_(row, HISTORY_COL.사유))
    });
  });

  items.reverse();
  return { ok: true, items: items.slice(0, limit || 30) };
}

/* ── 수정 ─────────────────────────────────────────────────────────── */

/** 로그 한 건을 찾는다. */
function findLog_(recordId) {
  var logs = readLogs_();
  for (var i = 0; i < logs.length; i++) {
    if (logs[i].기록ID === recordId) return logs[i];
  }
  return null;
}

/**
 * 출결 시각을 고친다.
 *
 * 출석부의 O 는 날짜가 바뀔 때만 옮긴다.
 * 같은 날 안에서 시각만 바꾸는 것은 출석부 표시(하루 한 칸)와 무관하다.
 *
 * @param {Object} req { token, ticket, recordId, atIso, reason, resend }
 */
function adminEditTime(req) {
  applyProbedLayout_();
  req = req || {};

  var device;
  try {
    device = requireAdmin_(req.token, req.ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }

  var reason = str_(req.reason);
  if (!reason) return { ok: false, message: '수정 사유를 입력해주세요.' };

  var at = toDate_(req.atIso);
  if (!at) return { ok: false, message: '시각을 해석할 수 없습니다.' };
  at.setSeconds(0, 0);

  var check = validateAttendTime_(at, now_(), ADMIN_BACKDATE_MAX_MIN);
  if (!check.ok) return { ok: false, message: check.reason };

  return withLock_(function () {
    var log = findLog_(req.recordId);
    if (!log) return { ok: false, message: '기록을 찾을 수 없습니다.' };
    if (log.상태 === LOGST.취소됨) {
      return { ok: false, message: '이미 취소된 기록입니다.' };
    }

    var before = fmtStamp_(log.출결시각);
    var sameDay = fmtDate_(log.출결시각) === fmtDate_(at);
    var subjects = normalizeSubjectFilter_(log.과목);

    // 날짜가 바뀌면 출석부의 O 도 옮겨야 한다
    var moved = { off: 0, on: 0 };
    if (!sameDay && log.구분 === KIND.등원) {
      var un = unmarkAttendance_(log.이름, log.출결시각, MARK.출석, subjects);
      moved.off = un.ledger;
      var re = markAttendance_(log.이름, at, MARK.출석, subjects);
      moved.on = re.ledger;
    }

    var patch = {};
    patch[LOG_COL.출결시각] = fmtStamp_(at);
    patch[LOG_COL.상태] = LOGST.수정됨;
    updateLogCells_(log.행, patch);

    // 정정 알림을 다시 보낼지
    if (req.resend === true) {
      markSendResult_(log.행, SENDST.대기, '', '', '');
    }

    appendHistory_({
      대상기록ID: log.기록ID,
      작업: '시각수정',
      필드: '출결시각',
      이전값: before,
      이후값: fmtStamp_(at),
      수행자: device.label,
      사유: reason
    });

    clearTodayCache_();
    return {
      ok: true,
      message: log.이름 + ' ' + log.구분 + ' → ' + fmtTime_(at) +
        (sameDay ? '' : ' (' + fmtDate_(at) + ')') +
        (moved.on ? ' · 출석부 O 이동' : '') +
        (req.resend === true ? ' · 정정 알림 예약' : '')
    };
  });
}

/** 등원↔하원을 바꾼다. */
function adminEditKind(req) {
  applyProbedLayout_();
  req = req || {};

  var device;
  try {
    device = requireAdmin_(req.token, req.ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }

  var reason = str_(req.reason);
  if (!reason) return { ok: false, message: '수정 사유를 입력해주세요.' };

  var next = (req.kind === KIND.하원) ? KIND.하원 : KIND.등원;

  return withLock_(function () {
    var log = findLog_(req.recordId);
    if (!log) return { ok: false, message: '기록을 찾을 수 없습니다.' };
    if (log.상태 === LOGST.취소됨) return { ok: false, message: '이미 취소된 기록입니다.' };
    if (log.구분 === next) return { ok: false, message: '이미 ' + next + ' 입니다.' };

    var subjects = normalizeSubjectFilter_(log.과목);

    // 등원 → 하원 이면 O 를 거두고, 하원 → 등원 이면 O 를 찍는다
    var mark = { off: 0, on: 0 };
    if (log.구분 === KIND.등원) {
      mark.off = unmarkAttendance_(log.이름, log.출결시각, MARK.출석, subjects).ledger;
    } else {
      mark.on = markAttendance_(log.이름, log.출결시각, MARK.출석, subjects).ledger;
    }

    var patch = {};
    patch[LOG_COL.구분] = next;
    patch[LOG_COL.상태] = LOGST.수정됨;
    updateLogCells_(log.행, patch);

    appendHistory_({
      대상기록ID: log.기록ID,
      작업: '구분변경',
      필드: '구분',
      이전값: log.구분,
      이후값: next,
      수행자: device.label,
      사유: reason
    });

    clearTodayCache_();
    return {
      ok: true,
      message: log.이름 + ' ' + log.구분 + ' → ' + next +
        (mark.off ? ' · 출석부 O 해제' : '') + (mark.on ? ' · 출석부 O 표시' : '')
    };
  });
}

/**
 * 기록을 취소한다.
 *
 * 행을 지우지 않고 상태만 바꾼다. 지워버리면 왜 사라졌는지 알 수 없다.
 * 출석부의 O 도 함께 거두되, 그날 같은 학생의 다른 등원 기록이
 * 남아 있으면 O 는 유지한다.
 */
function adminCancel(req) {
  applyProbedLayout_();
  req = req || {};

  var device;
  try {
    device = requireAdmin_(req.token, req.ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }

  var reason = str_(req.reason);
  if (!reason) return { ok: false, message: '취소 사유를 입력해주세요.' };

  return withLock_(function () {
    var log = findLog_(req.recordId);
    if (!log) return { ok: false, message: '기록을 찾을 수 없습니다.' };
    if (log.상태 === LOGST.취소됨) return { ok: false, message: '이미 취소된 기록입니다.' };

    var subjects = normalizeSubjectFilter_(log.과목);
    var removed = 0;

    if (log.구분 === KIND.등원) {
      // 같은 날 · 같은 학생 · 같은 과목의 다른 등원이 남아 있으면 O 를 둔다
      var day = fmtDate_(log.출결시각);
      var others = readLogs_().filter(function (r) {
        if (r.기록ID === log.기록ID) return false;
        if (r.학생ID !== log.학생ID) return false;
        if (r.구분 !== KIND.등원) return false;
        if (r.상태 === LOGST.취소됨) return false;
        if (!r.출결시각 || fmtDate_(r.출결시각) !== day) return false;
        return subjectsOverlap_(normalizeSubjectFilter_(r.과목), subjects);
      });

      if (!others.length) {
        removed = unmarkAttendance_(log.이름, log.출결시각, MARK.출석, subjects).ledger;
      }
    }

    var patch = {};
    patch[LOG_COL.상태] = LOGST.취소됨;
    updateLogCells_(log.행, patch);

    // 아직 안 나간 알림은 보내지 않는다
    if (log.발송상태 === SENDST.대기) {
      markSendResult_(log.행, SENDST.관리자, '', '', '취소된 기록');
    }

    appendHistory_({
      대상기록ID: log.기록ID,
      작업: '취소',
      필드: '상태',
      이전값: log.상태,
      이후값: LOGST.취소됨,
      수행자: device.label,
      사유: reason
    });

    clearTodayCache_();
    return {
      ok: true,
      message: log.이름 + ' ' + log.구분 + ' ' + fmtTime_(log.출결시각) + ' 취소' +
        (removed ? ' · 출석부 O 해제' : ' · 출석부는 그대로(다른 기록 있음)')
    };
  });
}

/**
 * 누락된 기록을 손으로 추가한다.
 * 태블릿의 기록 경로를 그대로 쓰되 관리자 권한으로 소급을 허용한다.
 */
function adminAddRecord(req) {
  applyProbedLayout_();
  req = req || {};

  try {
    requireAdmin_(req.token, req.ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }
  if (!str_(req.reason)) return { ok: false, message: '추가 사유를 입력해주세요.' };

  var res = recordAttendance({
    token: req.token,
    adminTicket: req.ticket,
    studentId: req.studentId,
    kind: req.kind,
    atIso: req.atIso,
    subjects: req.subjects,
    notify: req.notify === true,
    force: true
  });

  if (res.ok) {
    appendHistory_({
      대상기록ID: res.recordId,
      작업: '수동추가',
      필드: '',
      이전값: '',
      이후값: res.name + ' ' + res.kind + ' ' + res.date + ' ' + res.at,
      수행자: '관리자 화면',
      사유: str_(req.reason)
    });
  }
  return res;
}

/** 실패한 발송 한 건을 다시 대기로 돌린다. */
function adminResend(req) {
  applyProbedLayout_();
  req = req || {};

  var device;
  try {
    device = requireAdmin_(req.token, req.ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }

  return withLock_(function () {
    var log = findLog_(req.recordId);
    if (!log) return { ok: false, message: '기록을 찾을 수 없습니다.' };
    if (log.상태 === LOGST.취소됨) return { ok: false, message: '취소된 기록은 보낼 수 없습니다.' };
    if (log.발송상태 === SENDST.성공) return { ok: false, message: '이미 발송된 기록입니다.' };

    markSendResult_(log.행, SENDST.대기, '', '', '');
    appendHistory_({
      대상기록ID: log.기록ID,
      작업: '재발송',
      필드: '발송상태',
      이전값: log.발송상태,
      이후값: SENDST.대기,
      수행자: device.label,
      사유: str_(req.reason) || '관리자 재발송'
    });

    return { ok: true, message: log.이름 + ' ' + log.구분 + ' 알림을 다시 보냅니다.' };
  });
}

/** 관리자 화면에서 쓸 재원·휴원 명부 (수동 추가용) */
function adminRoster(token, ticket) {
  applyProbedLayout_();
  try {
    requireAdmin_(token, ticket);
  } catch (e) {
    return { ok: false, needsUnlock: !!e.needsUnlock, message: e.message };
  }
  return { ok: true, students: getRoster().students };
}
