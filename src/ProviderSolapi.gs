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

/* 인증만 보는 조회들. 어느 것도 발송을 일으키지 않는다. */
var SOLAPI_BALANCE_ENDPOINT = 'https://api.solapi.com/cash/v1/balance';
var SOLAPI_SENDERID_ENDPOINT = 'https://api.solapi.com/senderid/v1/numbers';
var SOLAPI_CHANNEL_ENDPOINT = 'https://api.solapi.com/kakao/v2/channels';

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

  /**
   * 저장된 값이 값답지 않은지 본다.
   *
   * 인자 없이 setProviderSecrets 를 실행하면 문자열 'undefined' 가 들어간다.
   * 그러면 대행사는 "길이가 안 맞는다" 고만 답해서, 무엇을 잘못했는지
   * 알아내는 데 시간이 걸린다.
   */
  function brokenValues() {
    var bad = [];
    [[SECRET_KEY.solapiApiKey, apiKey], [SECRET_KEY.solapiApiSecret, apiSecret]]
      .forEach(function (pair) {
        var v = str_(pair[1]);
        if (v === 'undefined' || v === 'null') bad.push(pair[0] + ' = ' + v);
      });
    return bad;
  }

  /** 인증만 보는 GET. 발송을 일으키지 않는다. */
  function get(url) {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: auth() },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    var body = res.getContentText();
    var json = {};
    try { json = JSON.parse(body); } catch (e) { /* JSON 이 아닐 수 있다 */ }

    if (code >= 200 && code < 300) return { ok: true, json: json, body: body };
    return {
      ok: false,
      code: code,
      body: body,
      error: 'HTTP ' + code + ' ' +
        (json.errorMessage || json.errorCode || body.slice(0, 200))
    };
  }

  /**
   * 발신번호가 솔라피에 등록돼 있는지 본다.
   *
   * 응답 모양이 바뀌어도 견디도록 본문에서 숫자만 찾는다. 목록의 형태를
   * 맞히려다 틀리면, 등록돼 있는데도 없다고 겁을 주게 된다.
   */
  function checkSenderId() {
    if (!from) return ['! 발신번호 설정이 비어 있습니다.'];

    var r = get(SOLAPI_SENDERID_ENDPOINT);
    if (!r.ok) return ['- 발신번호 목록을 못 읽었습니다 (' + r.error + ')'];

    var digits = from.replace(/[^0-9]/g, '');
    if (r.body.replace(/[^0-9]/g, '').indexOf(digits) !== -1) {
      return ['발신번호 ' + from + ' 등록됨'];
    }
    return ['! 발신번호 ' + from + ' 가 등록 목록에 없습니다.',
            '  솔라피 콘솔에서 사전등록을 마쳐야 발송됩니다.'];
  }

  /** 발신프로필키가 실제로 있는 채널인지. 비어 있으면 문자만 나간다. */
  function checkChannel() {
    if (!pfId) return ['- 발신프로필키가 비어 있어 문자로만 나갑니다.'];

    var r = get(SOLAPI_CHANNEL_ENDPOINT);
    if (!r.ok) return ['- 발신프로필 목록을 못 읽었습니다 (' + r.error + ')'];
    if (r.body.indexOf(pfId) !== -1) return ['발신프로필 ' + pfId + ' 확인됨'];
    return ['! 발신프로필키가 목록에 없습니다: ' + pfId];
  }

  return {
    name: 'solapi',

    /**
     * 잔액 조회로 인증을 확인한다. 발송은 일어나지 않는다.
     *
     * 여기서 끝내지 않고 발신번호와 발신프로필까지 함께 본다. 알리고에서
     * 겪었듯이, 인증이 통과해도 발신번호가 등록돼 있지 않으면 첫 등원에서야
     * 실패를 발견한다. 미리 볼 수 있는 것은 미리 본다.
     */
    verify: function () {
      if (!apiKey || !apiSecret) {
        return { checked: true, ok: false, message: '솔라피 인증정보가 없습니다.' };
      }

      // 인자 없이 setProviderSecrets 를 돌리면 문자열 'undefined' 가 박힌다.
      // 길이가 안 맞는다는 응답만 보고는 원인을 짐작하기 어려우니 먼저 짚는다.
      var junk = brokenValues();
      if (junk.length) {
        return {
          checked: true, ok: false,
          message: '저장된 값이 망가져 있습니다: ' + junk.join(', '),
          details: SECRET_HELP.concat([
            '인자 없이 setProviderSecrets 를 실행하면 이렇게 저장됩니다.'
          ])
        };
      }

      var bal = get(SOLAPI_BALANCE_ENDPOINT);
      if (!bal.ok) {
        return {
          checked: true, ok: false,
          message: '인증 실패 — ' + bal.error,
          details: SECRET_HELP
        };
      }

      var details = [];
      var money = Number(bal.json.balance || 0) + Number(bal.json.point || 0);
      details.push('잔액 ' + money.toLocaleString() + '원');
      if (money <= 0) details.push('! 잔액이 없습니다. 충전 전에는 발송이 거절됩니다.');

      details = details.concat(checkSenderId());
      details = details.concat(checkChannel());

      return { checked: true, ok: true, message: '솔라피 인증 통과', details: details };
    },

    /** 발신번호가 등록돼 있는지. 못 읽으면 없다고 단정하지 않는다. */
    verifySender: function () { return checkSenderId(); },

    /**
     * 알림톡. SMS 폴백을 같은 요청에 실어 보낸다.
     *
     * 알림톡 본문은 카카오가 templateId + variables 로 만들므로 body 는 쓰지 않는다.
     * message.text 는 폴백으로 나갈 SMS 본문이다.
     *
     * @param {string} body         알림톡 본문 (솔라피에서는 쓰지 않는다)
     * @param {string} fallbackText 알림톡이 막혔을 때 대신 갈 SMS 본문
     */
    sendAlimtalk: function (to, templateId, vars, body, fallbackText) {
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
