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
