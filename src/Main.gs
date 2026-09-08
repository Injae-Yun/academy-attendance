/**
 * Main.gs — 커스텀 메뉴와 웹앱 진입점.
 */

/** 스프레드시트를 열 때 [출결 관리] 메뉴를 만든다. */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('출결 관리')
    .addItem('출결 앱 열기', 'showAppUrl')
    .addItem('관리자 화면 열기', 'showAdminUrl')
    .addItem('기기 등록 링크', 'showRegisterUrl')
    .addItem('웹앱 주소 등록', 'menuSetWebAppUrl')
    .addSeparator()
    .addItem('명부 동기화', 'menuSyncRoster')
    .addItem('출석부 재생성', 'menuRebuildAttendbook')
    .addSubMenu(ui.createMenu('수강료')
      .addItem('이월 미리보기 (변경 없음)', 'menuTuitionPreview')
      .addItem('이월 실행', 'menuTuitionApply'))
    .addItem('정합성 점검', 'menuCheckConsistency')
    .addSeparator()
    .addSubMenu(ui.createMenu('지출 관리')
      .addItem('원장 점검 (변경 없음)', 'menuAnalyzeExpense')
      .addItem('원장 정리 미리보기', 'menuCleanExpensePreview')
      .addItem('원장 정리 실행', 'menuCleanExpenseApply')
      .addSeparator()
      .addItem('지출 격자 새로고침', 'menuBuildExpenseGrid')
      .addItem('지출 저장', 'menuSaveExpenseGrid')
      .addItem('전년도 구성 복사', 'menuCopyPreviousYear'))
    .addSeparator()
    .addSubMenu(ui.createMenu('발송')
      .addItem('발송 설정 열기', 'menuOpenSettings')
      .addItem('발송 설정 점검', 'menuCheckMessaging')
      .addItem('공급사 연결 확인', 'menuCheckProvider')
      .addItem('발신 IP 확인', 'menuCheckOutboundIp')
      .addItem('알리고 진단', 'menuDiagnoseAligo')
      .addItem('수신거부 링크 만들기', 'menuOptoutSample')
      .addItem('지금 발송 처리', 'menuProcessQueue')
      .addItem('실패 건 재시도', 'menuRetryFailed'))
    .addSeparator()
    .addSubMenu(ui.createMenu('설치·설정')
      .addItem('최초 설치 (시트 생성 + 좌표 실측)', 'setup')
      .addItem('좌표 다시 실측', 'menuProbeLayout')
      .addSeparator()
      .addItem('자동 실행 켜기', 'menuInstallTriggers')
      .addItem('자동 실행 상태', 'menuListTriggers')
      .addItem('자동 실행 끄기', 'menuUninstallTriggers'))
    .addToUi();
}

/* ── 메뉴 핸들러 ─────────────────────────────────────────────────── */

/** 긴 리포트를 모달로 띄운다. alert 는 길이 제한이 있어 HTML 을 쓴다. */
function showReport_(title, text) {
  var html = HtmlService.createHtmlOutput(
    '<pre style="font:13px/1.6 ui-monospace,Consolas,monospace;' +
    'white-space:pre-wrap;word-break:break-word;margin:0;padding:12px">' +
    escapeHtml_(text) + '</pre>'
  ).setWidth(720).setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function menuSyncRoster() {
  showReport_('명부 동기화', syncRoster().report);
}

function menuRebuildAttendbook() {
  var ym = getBookYearMonth_();
  if (!ym) {
    showReport_('출석부 재생성', '출석부의 연도/수강월 셀을 읽을 수 없습니다.');
    return;
  }
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    '출석부 재생성',
    ym.year + '년 ' + ym.month + '월 출석부를 명단에서 다시 그립니다.\n\n' +
    '기록된 출결은 출석부(누적) 원장에서 그대로 복원되므로 사라지지 않습니다.\n' +
    '계속할까요?',
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;
  showReport_('출석부 재생성', rebuildAttendbook(ym.year, ym.month).report);
}

function menuCheckConsistency() {
  showReport_('정합성 점검', checkConsistency());
}

function menuTuitionPreview() {
  showReport_('수강료 이월 (미리보기)', syncTuition(null, null, false).report);
}

function menuTuitionApply() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    '수강료 이월',
    [
      '수강료(누적) 시트의 기준 연/월에 맞춰 학생 줄을 만듭니다.',
      '',
      '이미 있는 줄은 건드리지 않습니다. 결제일·교재비는 비워 둡니다.',
      '먼저 [이월 미리보기] 로 대상을 확인하셨나요?'
    ].join('\n'),
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;
  showReport_('수강료 이월', syncTuition(null, null, true).report);
}

function menuProbeLayout() {
  showReport_('좌표 실측', probeLayout());
}

function menuAnalyzeExpense() {
  showReport_('지출 원장 점검', analyzeExpenseLedger());
}

function menuCleanExpensePreview() {
  showReport_('지출 원장 정리 (미리보기)', cleanExpenseLedger(false));
}

function menuCleanExpenseApply() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    '지출 원장 정리',
    '월 표기를 통일하고 완전히 동일한 중복 행을 제거합니다.\n\n' +
    '금액이나 항목이 조금이라도 다르면 지우지 않습니다.\n' +
    '먼저 [원장 정리 미리보기] 로 대상을 확인하셨나요?',
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;
  showReport_('지출 원장 정리', cleanExpenseLedger(true));
}

function menuBuildExpenseGrid() {
  var report = buildExpenseGrid();
  var sh = sheet_(APP_SHEET.지출입력, true);
  if (sh) ss_().setActiveSheet(sh);
  showReport_('지출 격자', report);
}

function menuSaveExpenseGrid() {
  showReport_('지출 저장', saveExpenseGrid());
}

function menuCopyPreviousYear() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.alert(
    '전년도 구성 복사',
    '격자의 금액을 전년도 구성으로 덮어씁니다.\n' +
    '12개월 금액이 모두 같은 고정비만 금액까지 복사하고, 나머지는 비웁니다.\n\n' +
    '아직 저장하지 않은 격자 내용이 있으면 사라집니다. 계속할까요?',
    ui.ButtonSet.OK_CANCEL
  );
  if (res !== ui.Button.OK) return;
  showReport_('전년도 구성 복사', copyPreviousYearExpense());
}

/** 설정 시트를 띄운다. 숨겨져 있으면 먼저 보이게 한다. */
function menuOpenSettings() {
  var sh = sheet_(APP_SHEET.설정, true);
  if (!sh) {
    showReport_('발송 설정', '_출결_설정 시트가 없습니다. [최초 설치] 를 먼저 실행해주세요.');
    return;
  }
  if (sh.isSheetHidden()) sh.showSheet();

  // 나중에 추가된 설정 항목이 시트에 없을 수 있다. 열 때마다 메운다.
  var added = ensureSettingKeys_();
  protectMessageTemplates_();
  ss_().setActiveSheet(sh);

  showReport_('발송 설정',
    [
      '_출결_설정 시트를 열었습니다. B열의 값을 고치면 됩니다.',
      (added.length ? '빠져 있던 항목 ' + added.length + '건을 추가했습니다: ' + added.join(', ') : ''),
      '',
      '  공급사          test / solapi / aligo',
      '                  (test 면 실제로 보내지 않고 로그만 남깁니다)',
      '  발신번호        사전등록한 학원 대표번호',
      '  문구_등원       ⚠ 알림톡 사용 중에는 수정 금지 (수정하면 확인 창이 뜹니다)',
      '  문구_하원       ⚠ 위와 같음. 등원·하원을 각각 심사받았습니다',
      '  문자문구_등원   알림톡이 막혔을 때 대신 갈 문자',
      '  문자문구_하원   위와 같음 (비우면 알림톡 문구에서 이모지만 빠집니다)',
      '  발신프로필키    알림톡 발신프로필 키 (비우면 SMS 로만 발송)',
      '  템플릿ID_등원   심사 통과한 등원 템플릿 코드',
      '  템플릿ID_하원   심사 통과한 하원 템플릿 코드',
      '  SMS폴백사용     TRUE / FALSE',
      '',
      '  쓸 수 있는 변수: #{학원명} #{학생명} #{날짜} #{시간}',
      '  이모지는 알림톡에만 나갑니다. 문자로 대체될 때는 자동으로 빠집니다.',
      '',
      'API 키·시크릿은 이 시트가 아니라 Script Properties 에 넣습니다.',
      "  setProviderSecrets('aligo', 'API키', '알리고아이디')",
      '',
      '고친 뒤 [발송 설정 점검] 으로 실제로 나갈 문구와 바이트 수를 확인하세요.'
    ].join('\n'));
}

function menuCheckMessaging() {
  showReport_('발송 설정 점검', checkMessagingSetup());
}

function menuCheckProvider() {
  showReport_('공급사 연결 확인', checkProviderAuth());
}

function menuCheckOutboundIp() {
  showReport_('발신 IP 확인', checkOutboundIp(5));
}

function menuDiagnoseAligo() {
  showReport_('알리고 진단', diagnoseAligo());
}

function menuProcessQueue() {
  showReport_('발송 처리', processMessageQueue().report);
}

function menuRetryFailed() {
  showReport_('실패 건 재시도', retryFailedMessages());
}

function menuInstallTriggers() {
  showReport_('자동 실행', installTriggers());
}

function menuListTriggers() {
  showReport_('자동 실행 상태', listTriggers());
}

function menuUninstallTriggers() {
  showReport_('자동 실행', uninstallTriggers());
}

/** 주소 뒤에 쿼리를 하나 붙인다. */
function withParam_(url, kv) {
  return url + (url.indexOf('?') === -1 ? '?' : '&') + kv;
}

/** /dev 주소밖에 없을 때 띄울 경고 */
var DEV_URL_WARN =
  '<b>이 주소는 태블릿에서 열리지 않습니다.</b> 배포 주소를 등록하지 않아 ' +
  '편집자 전용 개발 주소(<code>/dev</code>)를 보여주고 있습니다. ' +
  '메뉴의 <b>[웹앱 주소 등록]</b> 에 <code>/exec</code> 주소를 넣어주세요.';

/**
 * 주소를 띄운다. 링크와 함께 복사할 수 있는 입력칸을 준다.
 *
 * 모달 안의 링크는 팝업 차단에 걸리는 일이 잦다. 주소가 눈에 보이고 복사되면
 * 그런 경우에도 막히지 않는다.
 */
function showUrlDialog_(title, intro, url, note, warn) {
  var esc = escapeHtml_(url);
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.7 system-ui,-apple-system,sans-serif;padding:16px">' +
    (warn
      ? '<p style="margin:0 0 14px;padding:10px 12px;background:#fff4e5;' +
        'border-left:3px solid #f5a623;border-radius:4px;color:#8a5a00">' + warn + '</p>'
      : '') +
    '<p style="margin:0 0 10px">' + intro + '</p>' +
    '<div style="display:flex;gap:6px;margin:0 0 12px">' +
    '<input id="u" readonly value="' + esc + '" style="flex:1;min-width:0;padding:8px 10px;' +
    'font:13px ui-monospace,Consolas,monospace;border:1px solid #ccc;border-radius:6px">' +
    '<button id="c" style="padding:8px 14px;border:0;border-radius:6px;background:#1a73e8;' +
    'color:#fff;font-size:13px;cursor:pointer">복사</button></div>' +
    '<p style="margin:0 0 14px"><a href="' + esc + '" target="_blank" rel="noopener">새 탭에서 열기</a></p>' +
    '<p style="margin:0;color:#666;font-size:13px">' + note + '</p>' +
    '<script>' +
    'var i=document.getElementById("u"),b=document.getElementById("c");' +
    'i.onclick=function(){i.select();};' +
    'b.onclick=function(){i.select();' +
    'try{document.execCommand("copy");b.textContent="복사됨";}' +
    'catch(e){b.textContent="Ctrl+C 로 복사";}' +
    'setTimeout(function(){b.textContent="복사";},1600);};' +
    'i.focus();i.select();' +
    '<\/script></div>'
  ).setWidth(640).setHeight(warn ? 350 : 280);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

/** 주소를 전혀 모를 때 안내한다. */
function showNoUrl_(title) {
  showReport_(title, [
    '웹앱 주소를 알 수 없습니다.',
    '',
    '1. Apps Script 편집기 > 배포 > 배포 관리 에서 웹 앱 URL 을 복사하세요',
    '   (…/exec 로 끝나는 주소입니다)',
    '2. 메뉴 [출결 관리] > 웹앱 주소 등록 에 붙여넣으세요',
    '',
    '아직 배포한 적이 없다면 배포 > 새 배포 > 웹 앱 으로 먼저 배포해주세요.'
  ].join('\n'));
}

/** 출결 앱 주소를 안내한다. */
function showAppUrl() {
  var w = webAppUrl_();
  if (!w.url) { showNoUrl_('출결 앱'); return; }

  showUrlDialog_(
    '출결 앱 주소',
    '태블릿 브라우저에서 아래 주소를 열어주세요.',
    w.url,
    '처음 열면 기기 등록 화면이 나옵니다. 관리자 PIN 을 입력한 뒤 ' +
    '현관용은 키오스크, 데스크용은 직원 모드를 선택하세요.',
    w.source === 'dev' ? DEV_URL_WARN : ''
  );
}

/** 관리자 화면 주소를 안내한다. */
function showAdminUrl() {
  var w = webAppUrl_();
  if (!w.url) { showNoUrl_('관리자 화면'); return; }

  showUrlDialog_(
    '관리자 화면 주소',
    '기록을 수정·취소·재발송하는 화면입니다. ' +
    '출결 앱 주소 뒤에 <code>?page=admin</code> 을 붙인 것입니다.',
    withParam_(w.url, 'page=admin'),
    '기기 등록이 된 태블릿·PC 에서 열어야 하며, 관리자 PIN 을 한 번 더 입력합니다. ' +
    '인증은 30분간 유지됩니다.',
    w.source === 'dev' ? DEV_URL_WARN : ''
  );
}

/**
 * 학생 한 명의 수신거부 링크를 실제 값으로 만들어 본다.
 *
 * 알림톡 버튼에 등록하는 것은 #{수신거부키} 가 들어간 틀이라 그대로는 열리지
 * 않는다. 심사 전에 화면을 확인하거나, 보호자가 "링크를 못 받았다" 할 때
 * 여기서 만들어 전달한다.
 */
function menuOptoutSample() {
  applyProbedLayout_();

  var ui = SpreadsheetApp.getUi();
  var w = webAppUrl_();
  if (!w.url) { showNoUrl_('수신거부 링크'); return; }

  var res = ui.prompt(
    '수신거부 링크 만들기',
    '학생 이름을 입력하세요.\n비워 두면 명부의 첫 번째 재원생으로 만듭니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var name = String(res.getResponseText() || '').trim().replace(/\s/g, '');
  var 재원 = readStudents_().filter(function (s) { return s.상태 === ST.재원; });

  var hit = name
    ? 재원.filter(function (s) {
        return str_(s.표시명 || s.이름).replace(/\s/g, '') === name ||
               str_(s.이름).replace(/\s/g, '') === name;
      })
    : 재원.slice(0, 1);

  if (!hit.length) {
    showReport_('수신거부 링크',
      '"' + name + '" 을(를) 재원생 명부에서 찾을 수 없습니다.\n\n' +
      '표시명(동명이인 접미사 포함)으로도 찾아봅니다. ' +
      '이름을 다시 확인하거나 [명부 동기화] 를 먼저 실행해주세요.');
    return;
  }
  if (hit.length > 1) {
    showReport_('수신거부 링크',
      '"' + name + '" 이(가) ' + hit.length + '명입니다.\n\n' +
      hit.map(function (s) { return '  ' + (s.표시명 || s.이름) + '  (' + s.학생ID + ')'; }).join('\n') +
      '\n\n표시명을 그대로 입력해주세요.');
    return;
  }

  var s = hit[0];
  var display = s.표시명 || s.이름;
  var url = withParam_(w.url, 'page=optout&k=' + encodeURIComponent(optoutKey_(s.학생ID)));

  showUrlDialog_(
    '수신거부 링크',
    '<b>' + escapeHtml_(display) + '</b> 학생의 실제 링크입니다. ' +
    '휴대폰에서 열면 보호자가 보는 화면이 그대로 나옵니다.',
    url,
    '이 링크는 만료되지 않습니다. 알림톡 버튼에 등록할 때는 ' +
    '이 주소가 아니라 #{수신거부키} 가 들어간 틀을 넣으세요 — ' +
    '[발송 설정 점검] 에 나옵니다.',
    w.source === 'dev' ? DEV_URL_WARN : ''
  );
}

/**
 * 태블릿을 새로 등록할 때 쓰는 시한부 링크를 만든다.
 *
 * 평소에는 등록 화면이 아예 뜨지 않는다. 수신거부 버튼 때문에 웹앱 주소가
 * 보호자 휴대폰마다 들어가는데, 뒤를 잘라내면 관리자 PIN 입력창이 나오는
 * 상태로 둘 수는 없다.
 */
function showRegisterUrl() {
  var w = webAppUrl_();
  if (!w.url) { showNoUrl_('기기 등록 링크'); return; }

  var url = withParam_(w.url, 'r=' + encodeURIComponent(makeRegisterTicket_()));

  showUrlDialog_(
    '기기 등록 링크',
    '등록할 태블릿에서 아래 주소를 열어주세요. ' +
    '<b>' + REGISTER_LINK_MIN + '분간</b> 유효합니다.',
    url,
    '이 링크로 들어온 화면에서만 기기를 등록할 수 있고, 관리자 PIN 을 함께 ' +
    '입력해야 합니다. 등록이 끝나면 태블릿에 나오는 즐겨찾기 주소를 저장하세요. ' +
    '그 뒤로는 이 링크가 없어도 됩니다.',
    w.source === 'dev' ? DEV_URL_WARN : ''
  );
}

/** 배포 주소를 설정에 등록한다. */
function menuSetWebAppUrl() {
  var ui = SpreadsheetApp.getUi();
  var cur = String(setting_('웹앱주소', '') || '').trim();

  var res = ui.prompt(
    '웹앱 주소 등록',
    [
      'Apps Script 편집기 > 배포 > 배포 관리 에서 복사한 웹 앱 URL 을 붙여넣으세요.',
      '…/exec 로 끝나는 주소입니다.',
      '',
      cur ? '지금 등록된 주소:\n' + cur : '아직 등록된 주소가 없습니다.'
    ].join('\n'),
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var url = String(res.getResponseText() || '').trim();
  if (!url) {
    writeSetting_('웹앱주소', '');
    showReport_('웹앱 주소 등록', '등록된 주소를 지웠습니다.');
    return;
  }

  // 쿼리는 우리가 붙이므로 떼어낸다 (?page=admin 이 딸려 오는 일이 잦다).
  url = url.split('#')[0].split('?')[0].replace(/\/+$/, '');

  if (url.indexOf('https://') !== 0 || url.indexOf('/macros/') === -1) {
    showReport_('웹앱 주소 등록', [
      '웹 앱 주소로 보이지 않습니다:',
      url,
      '',
      '이런 모양이어야 합니다:',
      'https://script.google.com/macros/s/AKfycb.../exec'
    ].join('\n'));
    return;
  }

  if (/\/dev$/.test(url)) {
    showReport_('웹앱 주소 등록', [
      '개발용 주소(/dev)는 등록할 수 없습니다.',
      '',
      '/dev 는 스크립트 편집 권한이 있는 계정에서만 열립니다.',
      '태블릿에서는 열리지 않고, 구글 계정이 여러 개 로그인돼 있으면',
      '본인 PC 에서도 열리지 않습니다.',
      '',
      '배포 > 배포 관리 에서 /exec 로 끝나는 주소를 복사해주세요.'
    ].join('\n'));
    return;
  }

  if (!/\/exec$/.test(url)) {
    showReport_('웹앱 주소 등록', [
      '주소가 /exec 로 끝나지 않습니다:',
      url,
      '',
      '배포 > 배포 관리 에서 웹 앱 URL 을 다시 복사해주세요.'
    ].join('\n'));
    return;
  }

  writeSetting_('웹앱주소', url);
  showReport_('웹앱 주소 등록', [
    '등록했습니다.',
    '',
    '출결 앱      ' + url,
    '관리자 화면   ' + url + '?page=admin',
    '',
    '이제 메뉴의 [출결 앱 열기] · [관리자 화면 열기] 가 이 주소를 안내합니다.',
    '',
    '※ "새 배포" 로 다시 배포하면 주소가 바뀌니 그때는 여기서 다시 등록해주세요.',
    '   "배포 관리 → 연필 → 새 버전" 으로 올리면 주소는 그대로입니다.'
  ].join('\n'));
}

/* ── 웹앱 진입점 ─────────────────────────────────────────────────── */

/**
 * @param {Object} e 쿼리 파라미터.
 *   page=admin   관리자 화면
 *   page=optout  보호자 수신거부 (알림톡 버튼으로 들어온다)
 */
function doGet(e) {
  applyProbedLayout_();
  var params = (e && e.parameter) || {};
  var page = params.page || 'app';

  // 보호자가 휴대폰에서 여는 화면이다. 기기 토큰도 관리자 인증도 필요 없고,
  // 링크에 실린 서명 키만으로 어느 학생인지 가린다.
  if (page === 'optout') {
    var opt = HtmlService.createTemplateFromFile('Optout');
    opt.keyJson = toSafeJson_(str_(params.k));
    return opt.evaluate()
      .setTitle(getAcademyName_() + ' 출결 알림 설정')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  var file = page === 'admin' ? 'Admin' : 'App';
  var template = HtmlService.createTemplateFromFile(file);

  // 주소에 실린 기기 토큰을 화면으로 넘긴다.
  //
  // Apps Script 는 화면을 googleusercontent.com 의 임의 하위 도메인 iframe 으로
  // 띄우는데 그 주소가 바뀔 수 있다. 그러면 localStorage 에 둔 토큰이 날아가
  // 태블릿이 현관에서 다시 등록을 요구한다.
  // 주소에 ?t=토큰 을 달아 두면 그런 상황에서도 바로 복구된다.
  var appUrl = webAppUrl_().url;

  // ?a=티켓 은 태블릿에서 관리자 모드를 푼 채 관리자 화면으로 건너올 때 온다.
  // 서버가 기기·만료를 다시 검증하므로, 실려 있다고 해서 통과되는 것은 아니다.
  // 등록 화면은 시한부 링크로 들어온 사람에게만 보인다.
  // 그러지 않으면 수신거부 버튼으로 주소를 받은 보호자가 뒤를 잘라내
  // 관리자 PIN 입력창을 마주하게 된다.
  var regTicket = str_(params.r);
  var canRegister = verifyRegisterTicket_(regTicket);

  template.bootJson = toSafeJson_({
    token: str_(params.t),
    adminTicket: str_(params.a),
    regTicket: canRegister ? regTicket : '',
    canRegister: canRegister,
    appUrl: appUrl
  });

  return template.evaluate()
    .setTitle(getAcademyName_() + ' 출결')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** 스크립트 태그 안에 넣어도 안전한 JSON 문자열 */
function toSafeJson_(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** HTML 파일 안에서 다른 파일을 끼워 넣는다. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 있으면 끼워 넣고 없으면 조용히 넘어간다.
 *
 * 학원 로고(Brand.html)는 저장소에 올리지 않으므로, 코드만 받아 간 환경에는
 * 그 파일이 없다. 그때 화면이 통째로 죽으면 안 된다.
 */
function includeOptional(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (e) {
    return '';
  }
}
