/**
 * ProviderAligo.gs — 알리고(Aligo) 어댑터.
 *
 * SMS 는 apikey + user_id 폼 POST 로 끝나지만,
 * 알림톡은 먼저 토큰을 발급받아야 한다. 토큰은 유효 시간이 있어 캐시한다.
 *
 * 솔라피와 달리 알림톡 요청에 폴백을 실을 수 있어(failover) 그걸 쓴다.
 */

var ALIGO_SMS_ENDPOINT = 'https://apis.aligo.in/send/';
var ALIGO_TOKEN_ENDPOINT = 'https://kakaoapi.aligo.in/akv10/token/create/30/s/';
var ALIGO_ATALK_ENDPOINT = 'https://kakaoapi.aligo.in/akv10/alimtalk/send/';

/** 잔여건수 조회. 아무것도 보내지 않으면서 문자 API 인증만 확인할 수 있다. */
var ALIGO_REMAIN_ENDPOINT = 'https://apis.aligo.in/remain/';

/**
 * 알리고가 어디서 막는지 가려낸다. 아무것도 보내지 않는다.
 *
 * 알림톡(kakaoapi.aligo.in)과 문자(apis.aligo.in)는 서로 다른 서비스다.
 * 둘 다 막히면 IP·키 문제이고, 문자만 통과하면 알림톡 쪽 설정 문제다.
 * 그 둘을 갈라 봐야 어디를 고칠지 알 수 있다.
 *
 * @return {string} 리포트
 */
function diagnoseAligo() {
  applyProbedLayout_();

  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty(SECRET_KEY.aligoApiKey);
  var userId = props.getProperty(SECRET_KEY.aligoUserId);

  var lines = ['[알리고 진단]', ''];
  if (!apiKey || !userId) {
    lines.push('  인증정보가 없습니다.');
    lines.push("  setProviderSecrets('aligo', 'API키', '알리고아이디') 를 먼저 실행하세요.");
    return lines.join('\n');
  }
  lines.push('  아이디: ' + userId);
  lines.push('  API키 : ' + apiKey.slice(0, 4) + '…' + apiKey.slice(-4) +
    ' (' + apiKey.length + '자)');

  var ip = outboundIp_();
  lines.push('  나가는 IP: ' + (ip || '(못 읽음)'));
  lines.push('');

  /** 한 곳을 두드려 보고 날것 그대로 적는다. */
  function probe(label, url, params) {
    lines.push('  · ' + label);
    lines.push('    ' + url);
    try {
      var res = UrlFetchApp.fetch(url, {
        method: 'post', payload: params, muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      var body = String(res.getContentText()).trim();
      lines.push('    HTTP ' + code);
      lines.push('    응답: ' + body.slice(0, 300));

      var json = {};
      try { json = JSON.parse(body); } catch (e) { /* JSON 이 아닐 수 있다 */ }
      var okCode = (String(json.code) === '0' || String(json.result_code) === '1');
      lines.push('    판정: ' + (okCode ? '통과' : '거부'));
      return { ok: okCode, json: json };
    } catch (e) {
      lines.push('    호출 실패: ' + e.message);
      return { ok: false, json: {} };
    }
  }

  var sms = probe('문자 API (잔여건수 조회)', ALIGO_REMAIN_ENDPOINT,
    { key: apiKey, user_id: userId });
  var smsOk = sms.ok;

  // 잔액이 0 이면 인증이 통과해도 실제 발송에서 막힌다.
  // 조회한 김에 같이 보여준다.
  if (smsOk) {
    var cnt = sms.json.SMS_CNT;
    if (cnt !== undefined) {
      lines.push('    남은 문자: SMS ' + cnt +
        (sms.json.LMS_CNT !== undefined ? ' · LMS ' + sms.json.LMS_CNT : '') + '건');
      if (Number(cnt) === 0) {
        lines.push('    ! 잔액이 0 입니다. 충전해야 실제로 나갑니다.');
      }
    }
  }

  lines.push('');
  var atalk = probe('알림톡 API (토큰 발급)', ALIGO_TOKEN_ENDPOINT,
    { apikey: apiKey, userid: userId });
  var atalkOk = atalk.ok;

  lines.push('');
  lines.push('  ── 읽는 법 ──');
  lines.push('  잔액이 0 이어도 여기 두 호출은 통과합니다. 인증만 보기 때문입니다.');
  lines.push('  거부가 떴다면 잔액이 아니라 다른 이유입니다.');
  lines.push('');

  if (smsOk && atalkOk) {
    lines.push('  둘 다 통과입니다. 남은 것은 충전과 실제 발송뿐입니다.');
  } else if (smsOk && !atalkOk) {
    lines.push('  문자는 통과하는데 알림톡만 막힙니다.');
    lines.push('  IP 는 문제가 아닙니다 — 같은 IP 로 문자는 통과했습니다.');
    lines.push('  알림톡 서비스가 아직 열리지 않았거나, 알림톡 쪽에 IP 를');
    lines.push('  따로 등록해야 할 수 있습니다. 알리고에 이 화면을 보여주고');
    lines.push('  "문자는 되는데 알림톡 토큰 발급만 막힌다" 고 문의하세요.');
  } else if (!smsOk && !atalkOk) {
    lines.push('  둘 다 막힙니다. 문자·알림톡 공통이니 IP 나 키 문제입니다.');
    lines.push('');
    lines.push('  1) 알리고 [발송 서버 IP] 에 위 "나가는 IP" 가 있는지');
    lines.push('  2) 있다면, 그 IP 행에 적힌 발급키가 지금 쓰는 키와 같은지');
    lines.push('     알리고는 IP 마다 키를 따로 내줍니다. 다른 IP 의 키로는');
    lines.push('     IP 를 새로 등록해도 계속 막힙니다.');
    lines.push('     그 행의 키로 바꾸려면:');
    lines.push("       setProviderSecrets('aligo', '그 행의 발급키', '" + userId + "')");
    lines.push('  3) 둘 다 맞는데도 막히면 알리고에 이 화면을 그대로 보여주고');
    lines.push('     "어느 IP 로 보이길래 막히는지" 물어보세요.');
  } else {
    lines.push('  알림톡은 되는데 문자가 막힙니다. 흔치 않은 경우입니다.');
    lines.push('  알림톡만 쓰신다면 그대로 진행해도 됩니다.');
  }
  return lines.join('\n');
}

function AligoProvider_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty(SECRET_KEY.aligoApiKey);
  var userId = props.getProperty(SECRET_KEY.aligoUserId);
  var from = normalizePhone_(setting_('발신번호'));
  var senderKey = str_(setting_('발신프로필키'));

  function formPost(url, params) {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      payload: params,
      muteHttpExceptions: true
    });
    var body = res.getContentText();
    var json = {};
    try { json = JSON.parse(body); } catch (e) { /* 본문이 JSON 이 아닐 수 있다 */ }
    return { code: res.getResponseCode(), body: body, json: json };
  }

  /** 알림톡용 토큰. 30초짜리라 매번 새로 받는다. */
  function issueToken() {
    var r = formPost(ALIGO_TOKEN_ENDPOINT, { apikey: apiKey, userid: userId });
    if (r.json && String(r.json.code) === '0' && r.json.token) {
      return { ok: true, token: r.json.token };
    }
    return {
      ok: false,
      error: '알리고 토큰 발급 실패: ' + (r.json.message || r.body.slice(0, 200))
    };
  }

  function missingCreds() {
    if (apiKey && userId) return null;
    return {
      ok: false,
      error: '알리고 인증정보가 없습니다. setProviderSecrets(\'aligo\', 키, 사용자ID) 를 실행해주세요.'
    };
  }

  return {
    name: 'aligo',

    /**
     * 키와 아이디가 맞는지 확인한다. 아무것도 보내지 않는다.
     *
     * 토큰 발급은 인증만 보는 호출이라 문자도 알림톡도 나가지 않는다.
     * 아이디를 짐작으로 넣어 두고 첫 등원에서 실패를 발견하는 것보다 낫다.
     */
    verify: function () {
      var bad = missingCreds();
      if (bad) return { checked: true, ok: false, message: bad.error };

      var t = issueToken();
      if (t.ok) {
        return {
          checked: true, ok: true,
          message: '알리고 로그인 확인됨 (아이디 ' + userId + ')'
        };
      }
      // 알리고는 등록된 서버 IP 에서만 API 를 받는다. 그런데 Apps Script 는
      // 구글 서버에서 도는 데다 나갈 때 쓰는 IP 가 그때그때 달라, 미리 한 개를
      // 적어 둘 수가 없다. 키·아이디 문제로 오해하면 한참 헤맨다.
      if (String(t.error).indexOf('IP') !== -1) {
        var ip = outboundIp_();
        return {
          checked: true, ok: false,
          message: t.error + '\n' +
            '    키와 아이디 문제가 아닙니다. 알리고가 등록된 IP 에서 온\n' +
            '    호출만 받습니다.\n' +
            (ip
              ? '    지금 나가는 IP 는 ' + ip + ' 입니다.\n' +
                '    알리고 [발송 서버 IP] 에 이 값이 등록돼 있는지 보세요.\n' +
                '    방금 등록하셨다면 잠시 뒤 다시 눌러보세요.'
              : '    지금 나가는 IP 를 읽지 못했습니다. ' +
                '[발신 IP 확인] 을 눌러 확인해주세요.')
        };
      }
      return {
        checked: true, ok: false,
        message: t.error + '\n' +
          '    API 키나 아이디가 틀렸을 수 있습니다. 아이디는 알리고에 ' +
          '로그인할 때 쓰는 그 아이디입니다.'
      };
    },

    /**
     * @param {string} body         알림톡 본문. 심사 통과한 템플릿과 글자까지 같아야 한다
     * @param {string} fallbackText 알림톡이 막혔을 때 대신 갈 SMS 본문 (이모지 없음)
     */
    sendAlimtalk: function (to, templateId, vars, body, fallbackText) {
      var bad = missingCreds();
      if (bad) return bad;

      var t = issueToken();
      if (!t.ok) return { ok: false, error: t.error };

      // 알리고는 알림톡 본문을 직접 실어 보내고 템플릿과 대조한다.
      // 이모지를 걷어낸 SMS 본문을 여기 넣으면 글자가 달라 거부된다.
      var params = {
        apikey: apiKey,
        userid: userId,
        token: t.token,
        senderkey: senderKey,
        tpl_code: templateId,
        sender: from,
        receiver_1: normalizePhone_(to),
        subject_1: '출결 알림',
        message_1: body,
        testMode: 'N'
      };

      if (settingBool_('SMS폴백사용') && fallbackText) {
        params.failover = 'Y';
        params.fsubject_1 = '출결 알림';
        params.fmessage_1 = fallbackText;
      }

      var r = formPost(ALIGO_ATALK_ENDPOINT, params);
      if (r.json && String(r.json.code) === '0') {
        return { ok: true, channel: '알림톡', messageId: str_(r.json.info && r.json.info.mid) };
      }
      return {
        ok: false,
        error: '알리고 알림톡 ' + (r.json.code !== undefined ? r.json.code + ' ' : '') +
          (r.json.message || r.body.slice(0, 200))
      };
    },

    sendSms: function (to, text) {
      var bad = missingCreds();
      if (bad) return bad;

      var bytes = byteLengthEucKr_(text);
      var r = formPost(ALIGO_SMS_ENDPOINT, {
        key: apiKey,
        user_id: userId,
        sender: from,
        receiver: normalizePhone_(to),
        msg: text,
        msg_type: bytes > SMS_MAX_BYTES ? 'LMS' : 'SMS',
        testmode_yn: 'N'
      });

      if (r.json && String(r.json.result_code) === '1') {
        return {
          ok: true,
          channel: bytes > SMS_MAX_BYTES ? 'LMS' : 'SMS',
          messageId: str_(r.json.msg_id)
        };
      }
      return {
        ok: false,
        error: '알리고 SMS ' + (r.json.result_code !== undefined ? r.json.result_code + ' ' : '') +
          (r.json.message || r.body.slice(0, 200))
      };
    }
  };
}
