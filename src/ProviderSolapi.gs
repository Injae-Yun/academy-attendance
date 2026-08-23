/**
 * ProviderSolapi.gs — 솔라피(SOLAPI / CoolSMS) 어댑터.
 *
 * 인증은 HMAC-SHA256 서명이다.
 *   Authorization: HMAC-SHA256 apiKey=..., date=..., salt=..., signature=...
 *   signature = HMAC-SHA256(date + salt, apiSecret) 을 16진수로
 *
 * 알림톡은 한 번의 요청에 SMS 폴백까지 실어 보낼 수 있어서
 * 실패 시 재호출이 필요 없다. 알리고와 다른 점이다.
 */

var SOLAPI_ENDPOINT = 'https://api.solapi.com/messages/v4/send';

function SolapiProvider_() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty(SECRET_KEY.solapiApiKey);
  var apiSecret = props.getProperty(SECRET_KEY.solapiApiSecret);
  var from = normalizePhone_(setting_('발신번호'));
  var pfId = str_(setting_('발신프로필키'));

  function auth() {
    var date = new Date().toISOString();
    var salt = Utilities.getUuid().replace(/-/g, '');
    var raw = Utilities.computeHmacSha256Signature(date + salt, apiSecret);
    var signature = raw.map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    }).join('');
    return 'HMAC-SHA256 apiKey=' + apiKey + ', date=' + date +
      ', salt=' + salt + ', signature=' + signature;
  }

  function post(message) {
    if (!apiKey || !apiSecret) {
      return { ok: false, error: '솔라피 인증정보가 없습니다. setProviderSecrets(\'solapi\', 키, 시크릿) 을 실행해주세요.' };
    }

    var res = UrlFetchApp.fetch(SOLAPI_ENDPOINT, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: auth() },
      payload: JSON.stringify({ message: message }),
      muteHttpExceptions: true
    });

    var code = res.getResponseCode();
    var body = res.getContentText();
    var json = {};
    try { json = JSON.parse(body); } catch (e) { /* 본문이 JSON 이 아닐 수 있다 */ }

    if (code >= 200 && code < 300) {
      // statusCode 2000 대가 정상이다
      var status = String(json.statusCode || '');
      if (status && status.charAt(0) !== '2') {
        return { ok: false, error: '솔라피 ' + status + ' ' + (json.statusMessage || '') };
      }
      return {
        ok: true,
        channel: message.type === 'SMS' ? 'SMS' : '알림톡',
        messageId: str_(json.messageId || (json.groupId || ''))
      };
    }
    return {
      ok: false,
      error: 'HTTP ' + code + ' ' + (json.errorMessage || json.statusMessage || body.slice(0, 200))
    };
  }

  return {
    name: 'solapi',

    /**
     * 알림톡. SMS 폴백을 같은 요청에 실어 보낸다.
     * @param {string} fallbackText 알림톡이 막혔을 때 대신 갈 SMS 본문
     */
    sendAlimtalk: function (to, templateId, vars, fallbackText) {
      var message = {
        to: normalizePhone_(to),
        from: from,
        type: 'ATA',
        kakaoOptions: {
          pfId: pfId,
          templateId: templateId,
          variables: vars
        }
      };
      if (settingBool_('SMS폴백사용') && fallbackText) {
        message.kakaoOptions.disableSms = false;
        message.text = fallbackText;
      }
      var r = post(message);
      if (r.ok) r.channel = '알림톡';
      return r;
    },

    sendSms: function (to, text) {
      var bytes = byteLengthEucKr_(text);
      return post({
        to: normalizePhone_(to),
        from: from,
        type: bytes > SMS_MAX_BYTES ? 'LMS' : 'SMS',
        text: text
      });
    }
  };
}
