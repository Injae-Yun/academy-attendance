/**
 * Messaging.gs — 보호자 알림 발송.
 *
 * 태블릿은 로그에 '대기' 만 남기고 즉시 응답한다.
 * 실제 발송은 1분 주기 트리거가 여기서 배치로 처리한다.
 * 그래서 대행사 API 가 3초 걸려도 현관 줄이 밀리지 않는다.
 *
 * 공급사는 설정 한 줄로 갈아끼운다.
 *   test    실제로 보내지 않고 로그만 남긴다 (계정 없이 전 구간 점검용)
 *   solapi  HMAC-SHA256 서명
 *   aligo   key + userid 폼 POST
 */

/* ── 어댑터 ───────────────────────────────────────────────────────── */

/**
 * 설정된 공급사의 어댑터를 돌려준다.
 * @return {{name, sendAlimtalk, sendSms}}
 */
function getProvider_() {
  var name = String(setting_('공급사') || 'test').toLowerCase();
  if (name === 'solapi') return SolapiProvider_();
  if (name === 'aligo') return AligoProvider_();
  return TestProvider_();
}

/**
 * 계정이 없어도 전 구간을 점검할 수 있는 테스트 공급사.
 * 실제로 보내지 않고 성공으로 처리하며, 채널에 '테스트' 를 남긴다.
 */
function TestProvider_() {
  return {
    name: 'test',
    verify: function () {
      return { checked: true, ok: true, message: '테스트 모드라 확인할 인증정보가 없습니다.' };
    },
    sendAlimtalk: function (to, templateId, vars, body, fallbackText) {
      Logger.log('[테스트 알림톡] ' + to + ' / ' + templateId + ' / ' + JSON.stringify(vars));
      Logger.log('  본문: ' + body);
      Logger.log('  폴백: ' + fallbackText);
      return { ok: true, channel: '테스트(알림톡)', messageId: 'TEST-' + Utilities.getUuid().slice(0, 8) };
    },
    sendSms: function (to, text) {
      Logger.log('[테스트 SMS] ' + to + ' / ' + text);
      return { ok: true, channel: '테스트(SMS)', messageId: 'TEST-' + Utilities.getUuid().slice(0, 8) };
    }
  };
}

/* ── 문안 ─────────────────────────────────────────────────────────── */

/**
 * 알림 문구를 만든다.
 *
 * SMS 는 90바이트를 1바이트라도 넘으면 LMS 가 되어 단가가 3배다.
 * 그래서 학원명을 줄여서라도 90 안에 넣어보고, 그래도 안 되면
 * LMS 로 나간다는 사실을 로그에 남긴다.
 *
 * @return {{text, vars, bytes, fits, shortened}}
 */
function buildMessage_(academy, name, kind, at, studentId) {
  var template = messageTemplate_(kind);
  var word = KIND_WORD[kind] || KIND_WORD[KIND.등원];
  var emoji = KIND_EMOJI[kind] || KIND_EMOJI[KIND.등원];

  var varsFor = function (aca) {
    var v = {
      '#{학원명}': aca,
      '#{학생명}': name,
      '#{날짜}': fmtDotDate_(at),
      '#{시간}': fmtTime_(at),
      '#{등하원조건}': word,
      '#{이모티콘}': emoji,
      // 알림톡 버튼 링크에 실린다. 이 값 하나로 어느 학생인지 가린다.
      '#{수신거부키}': studentId ? optoutKey_(studentId) : ''
    };
    // 예전 이름으로 저장된 문구가 시트에 남아 있을 수 있다.
    // 조용히 '#{일자}' 글자가 그대로 발송되는 것보다 같이 받아주는 편이 낫다.
    Object.keys(MSG_VAR_ALIAS).forEach(function (oldName) {
      v[oldName] = v[MSG_VAR_ALIAS[oldName]];
    });
    return v;
  };

  // 알림톡 본문. 심사 통과한 문구 그대로 나가야 하므로 손대지 않는다.
  var text = applyVars_(template, varsFor(academy));

  // 문자 본문. 알림톡과 다른 문안을 따로 등록해 둘 수 있다.
  // 알림톡에는 없는 90바이트 제한이 있고 이모지도 못 쓰기 때문이다.
  // 따로 없으면 알림톡 문구에서 이모지만 걷어낸다.
  var smsTpl = smsTemplate_(kind);
  var buildSms = function (aca) {
    return stripEmoji_(applyVars_(smsTpl, varsFor(aca)));
  };
  var fitted = fitSmsText_(buildSms, academy);

  return {
    text: text,
    sms: fitted.text,
    template: template,
    vars: varsFor(academy),
    bytes: fitted.bytes,
    fits: fitted.fits,
    shortened: fitted.shortened
  };
}

/**
 * 알림톡 문구 틀. 설정이 비어 있으면 기본 문구를 쓴다.
 *
 * 등원·하원을 각각 심사받았으므로 문구도 두 벌이다.
 */
function messageTemplate_(kind) {
  var isOut = (kind === KIND.하원);
  return str_(setting_(isOut ? '문구_하원' : '문구_등원')) ||
    (isOut ? MSG_DEFAULT_OUT : MSG_DEFAULT_IN);
}

/**
 * 대체발송 문자 틀.
 *
 * 설정 시트에는 기본값(SMS_DEFAULT_*)이 미리 들어가 있다. 그 칸을 비우면
 * 알림톡 문구를 그대로 쓰고 이모지만 빠진다 — 문안을 한 벌로 관리하고
 * 싶을 때를 위한 길이다.
 */
function smsTemplate_(kind) {
  var custom = str_(setting_(kind === KIND.하원 ? '문자문구_하원' : '문자문구_등원'));
  return custom || messageTemplate_(kind);
}

/** #{변수} 를 실제 값으로 바꾼다. */
function applyVars_(template, vars) {
  var out = String(template);
  Object.keys(vars).forEach(function (k) {
    out = out.split(k).join(vars[k]);
  });
  return out;
}

var MSG_VARIABLES = [
  '#{학원명}', '#{학생명}', '#{날짜}', '#{시간}', '#{등하원조건}', '#{이모티콘}',
  '#{수신거부키}'
];

/** 예전 이름 → 지금 이름. 옛 문구가 남아 있어도 그대로 동작한다. */
var MSG_VAR_ALIAS = {
  '#{일자}': '#{날짜}',
  '#{시각}': '#{시간}',
  '#{구분}': '#{등하원조건}'
};

/**
 * 문구가 쓸 만한지 본다.
 * @return {{ok: boolean, problems: string[], unknown: string[]}}
 */
function validateTemplate_(template) {
  var problems = [];
  var t = str_(template);

  if (!t) {
    return { ok: false, problems: ['문구가 비어 있습니다.'], unknown: [] };
  }
  /** 지금 이름이든 예전 이름이든 들어 있으면 된다. */
  var has = function (name) {
    if (t.indexOf(name) !== -1) return true;
    return Object.keys(MSG_VAR_ALIAS).some(function (old) {
      return MSG_VAR_ALIAS[old] === name && t.indexOf(old) !== -1;
    });
  };

  if (!has('#{학생명}')) {
    problems.push('#{학생명} 이 없습니다. 누구의 알림인지 알 수 없습니다.');
  }
  if (!has('#{시간}')) {
    problems.push('#{시간} 이 없습니다. 출결 시각이 빠집니다.');
  }

  // 우리가 모르는 변수를 쓰면 그대로 문자로 나간다
  var unknown = [];
  var found = t.match(/#\{[^}]*\}/g) || [];
  found.forEach(function (v) {
    if (MSG_VARIABLES.indexOf(v) !== -1) return;
    if (MSG_VAR_ALIAS[v]) return;                 // 예전 이름도 받아준다
    if (unknown.indexOf(v) === -1) unknown.push(v);
  });
  if (unknown.length) {
    problems.push('알 수 없는 변수: ' + unknown.join(', ') + ' — 글자 그대로 발송됩니다.');
  }

  return { ok: problems.length === 0, problems: problems, unknown: unknown };
}

/** 알림톡 템플릿 코드. 등원·하원을 각각 심사받았으므로 두 벌이다. */
function templateFor_(kind) {
  return str_(setting_(kind === KIND.하원 ? '템플릿ID_하원' : '템플릿ID_등원'));
}

/* ── 한 건 발송 ───────────────────────────────────────────────────── */

/**
 * 로그 한 건을 발송한다.
 *
 * 알림톡을 먼저 시도하고, 실패하면 SMS 로 대체한다.
 * 솔라피는 요청 한 번으로 폴백까지 처리하고 알리고는 응답을 보고
 * 다시 호출해야 하는데, 그 차이는 어댑터가 흡수한다.
 *
 * @return {{ok, channel, messageId, error}}
 */
function sendOne_(provider, academy, student, log) {
  var msg = buildMessage_(academy, log.이름, log.구분, log.출결시각, log.학생ID);
  var to = student.보호자연락처;
  var templateId = templateFor_(log.구분);
  var useAlimtalk = !!templateId && !!str_(setting_('발신프로필키'));

  if (useAlimtalk) {
    // 폴백 본문은 이모지를 걷어낸 쪽으로 넘긴다.
    // 대행사가 알림톡 실패 시 이 문장을 SMS 로 그대로 보낸다.
    var res = provider.sendAlimtalk(to, templateId, msg.vars, msg.text, msg.sms);
    if (res.ok) return res;

    if (!settingBool_('SMS폴백사용')) {
      return { ok: false, channel: '알림톡', messageId: '', error: res.error || '알림톡 발송 실패' };
    }
    var sms = provider.sendSms(to, msg.sms);
    if (sms.ok) {
      sms.channel = sms.channel + ' (알림톡 대체)';
      return sms;
    }
    return { ok: false, channel: 'SMS', messageId: '', error: (res.error || '') + ' / ' + (sms.error || '') };
  }

  // 알림톡 준비 전이면 SMS 로만 보낸다
  if (!msg.fits) {
    Logger.log('문구가 ' + msg.bytes + '바이트라 LMS 로 나갑니다: ' + msg.sms);
  }
  return provider.sendSms(to, msg.sms);
}

/* ── 큐 처리 ──────────────────────────────────────────────────────── */

/** 재시도 최대 횟수. 이후에는 실패로 확정하고 관리자에게 보인다. */
var SEND_MAX_TRY = 3;

/** 한 번에 처리할 최대 건수. Apps Script 실행 시간(6분)을 넘기지 않게 한다. */
var SEND_BATCH_SIZE = 40;

/**
 * 발송 대기 중인 로그를 처리한다. 1분 주기 트리거가 호출한다.
 * @return {{sent, failed, skipped, report}}
 */
function processMessageQueue() {
  applyProbedLayout_();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return { sent: 0, failed: 0, skipped: 0, report: '이전 발송이 아직 진행 중입니다.' };
  }

  try {
    var logs = readLogs_();
    var pending = logs.filter(function (r) {
      return r.발송상태 === SENDST.대기 && r.상태 !== LOGST.취소됨;
    }).slice(0, SEND_BATCH_SIZE);

    if (!pending.length) {
      return { sent: 0, failed: 0, skipped: 0, report: '발송할 건이 없습니다.' };
    }

    var provider = getProvider_();
    var academy = getAcademyName_();
    var from = str_(setting_('발신번호'));

    if (provider.name !== 'test' && !from) {
      return {
        sent: 0, failed: 0, skipped: pending.length,
        report: '발신번호가 설정되지 않아 발송하지 않았습니다. ' +
          '_출결_설정 시트의 발신번호를 채워주세요.'
      };
    }

    var byId = {};
    readStudents_().forEach(function (s) { byId[s.학생ID] = s; });

    var sent = 0, failed = 0, skipped = 0;
    var lines = [];

    pending.forEach(function (log) {
      var student = byId[log.학생ID];

      if (!student || !student.알림수신) {
        markSendResult_(log.행, SENDST.수신거부, '', '', '');
        skipped++;
        return;
      }
      if (!student.보호자연락처) {
        markSendResult_(log.행, SENDST.번호없음, '', '', '');
        skipped++;
        return;
      }

      var res;
      try {
        res = sendOne_(provider, academy, student, log);
      } catch (e) {
        res = { ok: false, channel: '', messageId: '', error: e.message };
      }

      if (res.ok) {
        markSendResult_(log.행, SENDST.성공, res.channel, res.messageId, '');
        sent++;
        return;
      }

      // 실패 — 재시도 횟수를 세어 한도를 넘으면 확정한다
      var tries = countTries_(log.오류) + 1;
      if (tries >= SEND_MAX_TRY) {
        markSendResult_(log.행, SENDST.실패, res.channel, '',
          '(' + tries + '회 시도) ' + (res.error || '원인 불명'));
        failed++;
      } else {
        markSendResult_(log.행, SENDST.대기, '', '',
          '(' + tries + '회 시도) ' + (res.error || '원인 불명'));
      }
      lines.push(log.이름 + ' ' + log.구분 + ': ' + (res.error || '실패'));
    });

    var report = ['[발송] 성공 ' + sent + ' · 실패 ' + failed + ' · 건너뜀 ' + skipped];
    if (lines.length) {
      report.push('');
      lines.slice(0, 20).forEach(function (l) { report.push('  · ' + l); });
    }
    return { sent: sent, failed: failed, skipped: skipped, report: report.join('\n') };

  } finally {
    lock.releaseLock();
  }
}

/** 오류 문구 앞머리의 '(N회 시도)' 를 읽는다. */
function countTries_(errorText) {
  var m = String(errorText || '').match(/^\((\d+)회 시도\)/);
  return m ? Number(m[1]) : 0;
}

/** 발송 결과를 로그 행에 쓴다. */
function markSendResult_(row, state, channel, messageId, error) {
  var patch = {};
  patch[LOG_COL.발송상태] = state;
  patch[LOG_COL.발송채널] = channel || '';
  patch[LOG_COL.메시지ID] = messageId || '';
  patch[LOG_COL.발송시각] = (state === SENDST.성공) ? fmtStamp_(now_()) : '';
  patch[LOG_COL.오류] = error || '';
  updateLogCells_(row, patch);
}

/* ── 관리자용 ─────────────────────────────────────────────────────── */

/**
 * 실패로 확정된 건을 다시 대기로 돌린다.
 * @return {string} 리포트
 */
function retryFailedMessages() {
  applyProbedLayout_();

  var count = 0;
  readLogs_().forEach(function (r) {
    if (r.발송상태 !== SENDST.실패) return;
    markSendResult_(r.행, SENDST.대기, '', '', '');
    count++;
  });

  if (!count) return '재시도할 실패 건이 없습니다.';
  var result = processMessageQueue();
  return '[재시도] ' + count + '건을 대기로 돌렸습니다.\n\n' + result.report;
}

/**
 * 공급사에 실제로 물어본다. 아무것도 보내지 않는다.
 *
 * 설정 점검은 시트에 값이 있는지만 본다. 값이 틀렸는지는 알 수 없어서
 * 첫 등원에서야 실패를 발견하게 된다. 그 전에 확인할 길을 둔다.
 *
 * @return {string} 리포트
 */
function checkProviderAuth() {
  applyProbedLayout_();

  var provider = getProvider_();
  var lines = ['[공급사 연결 확인]', '  공급사: ' + provider.name, ''];

  if (!provider.verify) {
    lines.push('  이 공급사는 확인 기능이 없습니다.');
    return lines.join('\n');
  }

  var res;
  try {
    res = provider.verify();
  } catch (e) {
    return lines.concat(['  ! 확인 중 오류: ' + e.message]).join('\n');
  }

  if (!res.checked) {
    lines.push('  - ' + res.message);
  } else if (res.ok) {
    lines.push('  ✓ ' + res.message);
    lines.push('');
    lines.push('  인증은 통과했습니다. 템플릿 코드가 맞는지는 실제 발송으로 확인하세요.');
  } else {
    lines.push('  ✗ ' + res.message);
  }
  return lines.join('\n');
}

/**
 * 발송 설정이 제대로 되어 있는지 점검한다. 실제로 보내지 않는다.
 * @return {string} 리포트
 */
function checkMessagingSetup() {
  applyProbedLayout_();

  var provider = String(setting_('공급사') || 'test').toLowerCase();
  var props = PropertiesService.getScriptProperties();
  var lines = ['[발송 설정 점검]', '  공급사: ' + provider];

  if (provider === 'test') {
    lines.push('  → 테스트 모드입니다. 실제로 발송되지 않고 로그만 남습니다.');
  } else if (provider === 'solapi') {
    lines.push('  API 키: ' + (props.getProperty(SECRET_KEY.solapiApiKey) ? '설정됨' : '없음 ✗'));
    lines.push('  API 시크릿: ' + (props.getProperty(SECRET_KEY.solapiApiSecret) ? '설정됨' : '없음 ✗'));
  } else if (provider === 'aligo') {
    lines.push('  API 키: ' + (props.getProperty(SECRET_KEY.aligoApiKey) ? '설정됨' : '없음 ✗'));
    lines.push('  사용자 ID: ' + (props.getProperty(SECRET_KEY.aligoUserId) ? '설정됨' : '없음 ✗'));
  } else {
    lines.push('  ! 알 수 없는 공급사입니다. test / solapi / aligo 중 하나여야 합니다.');
  }

  var from = str_(setting_('발신번호'));
  lines.push('  발신번호: ' + (from ? formatPhone_(from) : '없음 ✗ (사전등록한 번호를 넣어주세요)'));

  var pf = str_(setting_('발신프로필키'));
  var tIn = templateFor_(KIND.등원);
  var tOut = templateFor_(KIND.하원);
  var tid = !!(pf && tIn && tOut);

  if (tid) {
    lines.push('  알림톡: 사용 (발신프로필 + 템플릿 2종 설정됨)');
  } else {
    lines.push('  알림톡: 미사용 → 문자로만 발송합니다');
    if (!pf) lines.push('    · 발신프로필키 없음');
    if (!tIn) lines.push('    · 템플릿ID_등원 없음');
    if (!tOut) lines.push('    · 템플릿ID_하원 없음');
  }
  lines.push('  SMS 폴백: ' + (settingBool_('SMS폴백사용') ? '사용' : '미사용'));

  // 문구를 검사하고 실제로 나갈 모습을 보여준다
  lines.push('');
  lines.push('[문구]  _출결_설정 시트에서 고칩니다. 등원·하원이 각각 따로입니다');
  lines.push('  쓸 수 있는 변수: ' + MSG_VARIABLES.join(' '));

  [KIND.등원, KIND.하원].forEach(function (kind) {
    var suffix = (kind === KIND.하원) ? '하원' : '등원';
    var template = messageTemplate_(kind);
    var check = validateTemplate_(template);
    var sample = buildMessage_(getAcademyName_(), '남궁철수', kind, now_(), 'S001');
    var flat = function (t) { return t.split('\n').join(' ⏎ '); };

    lines.push('');
    lines.push('  · ' + kind + '  (템플릿ID_' + suffix + ': ' +
      (templateFor_(kind) || '없음 ✗') + ')');
    lines.push('    알림톡: ' + flat(sample.text));
    lines.push('    문자  : ' + flat(sample.sms));
    lines.push('    ' + sample.bytes + '바이트 — ' +
      (sample.fits ? '문자 1건으로 나갑니다' : '90바이트 초과 → LMS 단가 3배'));

    if (!str_(setting_('문자문구_' + suffix))) {
      lines.push('    (문자문구_' + suffix + ' 가 비어 있어 기본 문안을 씁니다)');
    }
    if (sample.shortened) {
      lines.push('    ! 90바이트에 맞추려고 학원명을 줄였습니다.');
    }
    check.problems.forEach(function (msg) { lines.push('    ! ' + msg); });
  });

  // 수신거부 버튼은 템플릿의 일부라 심사 때 같이 올려야 한다
  lines.push('');
  lines.push('[수신거부 버튼]  알림톡 템플릿에 웹링크 버튼으로 등록합니다');
  lines.push('  버튼명: 출결 알림 받지 않기');

  var base = webAppUrl_().url;
  if (!base) {
    lines.push('  ! 웹앱 주소가 등록되지 않아 링크를 만들 수 없습니다.');
    lines.push('    메뉴 [출결 관리] > 웹앱 주소 등록 을 먼저 해주세요.');
  } else {
    lines.push('');
    lines.push('  (1) 대행사 콘솔이 버튼 링크에 변수를 받아준다면 — 권장');
    lines.push('      ' + optoutLinkTemplate_());
    lines.push('      누르면 그 학생 화면이 바로 열립니다.');
    lines.push('');
    lines.push('  (2) 링크가 고정 입력만 되면');
    lines.push('      ' + optoutFixedLink_());
    lines.push('      보호자가 학생 이름과 연락처를 넣어 본인 확인을 합니다.');
    lines.push('      둘 다 맞아야 열립니다.');
  }
  lines.push('');
  lines.push('  ※ SMS 로 대체될 때는 버튼이 없습니다. 문자만 받는 보호자는');
  lines.push('     학원에 말씀하시면 _출결_학생 시트에서 꺼드리면 됩니다.');

  if (pf && tid) {
    lines.push('');
    lines.push('  ! 알림톡을 쓰는 중입니다. 문구를 바꾸면 심사 통과한 템플릿과');
    lines.push('    글자가 달라져 발송이 거부될 수 있습니다.');
    lines.push('    문구를 바꾸려면 대행사에서 템플릿을 다시 심사받으세요.');
    lines.push('    (SMS 폴백으로 나가는 문구는 자유롭게 바꿔도 됩니다)');
  }

  var logs = readLogs_();
  var countBy = function (state) {
    return logs.filter(function (r) { return r.발송상태 === state; }).length;
  };
  lines.push('');
  lines.push('  대기 ' + countBy(SENDST.대기) + '건 · 실패 ' + countBy(SENDST.실패) + '건');
  lines.push('  미발송 — 수신거부 ' + countBy(SENDST.수신거부) +
    ' · 번호없음 ' + countBy(SENDST.번호없음) +
    ' · 관리자 소급 ' + countBy(SENDST.관리자));

  return lines.join('\n');
}
