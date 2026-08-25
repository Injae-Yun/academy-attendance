/**
 * Main.gs — 커스텀 메뉴와 웹앱 진입점.
 */

/** 스프레드시트를 열 때 [출결 관리] 메뉴를 만든다. */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('출결 관리')
    .addItem('출결 앱 열기', 'showAppUrl')
    .addItem('관리자 화면 열기', 'showAdminUrl')
    .addSeparator()
    .addItem('명부 동기화', 'menuSyncRoster')
    .addItem('출석부 재생성', 'menuRebuildAttendbook')
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
      '  문구_등원       ⚠ 알림톡 사용 중에는 수정 금지',
      '  문구_하원       ⚠ 위와 같음 (수정하면 확인 창이 뜹니다)',
      '  발신프로필키    알림톡 발신프로필 키 (비우면 SMS 로만 발송)',
      '  템플릿ID_등원   심사 통과한 알림톡 템플릿 코드',
      '  템플릿ID_하원   위와 같음',
      '  SMS폴백사용     TRUE / FALSE',
      '',
      '  쓸 수 있는 변수: #{학원명} #{학생명} #{일자} #{시각}',
      '',
      'API 키·시크릿은 이 시트가 아니라 Script Properties 에 넣습니다.',
      "  setProviderSecrets('solapi', '키', '시크릿')",
      '',
      '고친 뒤 [발송 설정 점검] 으로 실제로 나갈 문구와 바이트 수를 확인하세요.'
    ].join('\n'));
}

function menuCheckMessaging() {
  showReport_('발송 설정 점검', checkMessagingSetup());
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

/** 배포된 웹앱 주소를 안내한다. */
function showAppUrl() {
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    showReport_('출결 앱',
      '웹앱이 아직 배포되지 않았습니다.\n\n' +
      'Apps Script 편집기 > 배포 > 새 배포 > 웹 앱 으로 배포한 뒤 다시 시도해주세요.');
    return;
  }
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.7 -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;padding:16px">' +
    '<p style="margin:0 0 12px">태블릿에서 아래 주소를 열어주세요.</p>' +
    '<p style="margin:0 0 16px"><a href="' + url + '" target="_blank">' + escapeHtml_(url) + '</a></p>' +
    '<p style="margin:0;color:#666;font-size:13px">' +
    '처음 열면 기기 등록 화면이 나옵니다. 관리자 PIN 을 입력한 뒤 ' +
    '현관용은 키오스크, 데스크용은 직원 모드를 선택하세요.</p></div>'
  ).setWidth(560).setHeight(240);
  SpreadsheetApp.getUi().showModalDialog(html, '출결 앱 주소');
}

/** 관리자 화면 주소를 안내한다. */
function showAdminUrl() {
  var url = ScriptApp.getService().getUrl();
  if (!url) {
    showReport_('관리자 화면',
      '웹앱이 아직 배포되지 않았습니다.\n\n' +
      'Apps Script 편집기 > 배포 > 새 배포 > 웹 앱 으로 배포한 뒤 다시 시도해주세요.');
    return;
  }
  var adminUrl = url + (url.indexOf('?') === -1 ? '?' : '&') + 'page=admin';
  var html = HtmlService.createHtmlOutput(
    '<div style="font:14px/1.7 -apple-system,BlinkMacSystemFont,sans-serif;padding:16px">' +
    '<p style="margin:0 0 12px">아래 주소에서 기록을 수정·취소·재발송할 수 있습니다.</p>' +
    '<p style="margin:0 0 16px"><a href="' + adminUrl + '" target="_blank">' +
    escapeHtml_(adminUrl) + '</a></p>' +
    '<p style="margin:0;color:#666;font-size:13px">' +
    '기기 등록이 된 태블릿·PC 에서 열어야 하며, 관리자 PIN 을 한 번 더 입력합니다. ' +
    '인증은 30분간 유지됩니다.</p></div>'
  ).setWidth(620).setHeight(250);
  SpreadsheetApp.getUi().showModalDialog(html, '관리자 화면 주소');
}

/* ── 웹앱 진입점 ─────────────────────────────────────────────────── */

/**
 * @param {Object} e 쿼리 파라미터. page=admin 이면 관리자 화면.
 */
function doGet(e) {
  applyProbedLayout_();
  var params = (e && e.parameter) || {};
  var page = params.page || 'app';
  var file = page === 'admin' ? 'Admin' : 'App';

  var template = HtmlService.createTemplateFromFile(file);

  // 주소에 실린 기기 토큰을 화면으로 넘긴다.
  //
  // Apps Script 는 화면을 googleusercontent.com 의 임의 하위 도메인 iframe 으로
  // 띄우는데 그 주소가 바뀔 수 있다. 그러면 localStorage 에 둔 토큰이 날아가
  // 태블릿이 현관에서 다시 등록을 요구한다.
  // 주소에 ?t=토큰 을 달아 두면 그런 상황에서도 바로 복구된다.
  var appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl() || ''; } catch (err) { appUrl = ''; }

  template.bootJson = toSafeJson_({
    token: str_(params.t),
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
