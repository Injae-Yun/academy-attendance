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

    sendAlimtalk: function (to, templateId, vars, fallbackText) {
      var bad = missingCreds();
      if (bad) return bad;

      var t = issueToken();
      if (!t.ok) return { ok: false, error: t.error };

      // 알림톡 본문은 템플릿과 글자까지 같아야 한다.
      // 우리 템플릿은 SMS 문안과 동일하게 심사받으므로 그대로 쓴다.
      var params = {
        apikey: apiKey,
        userid: userId,
        token: t.token,
        senderkey: senderKey,
        tpl_code: templateId,
        sender: from,
        receiver_1: normalizePhone_(to),
        subject_1: '출결 알림',
        message_1: fallbackText,
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
