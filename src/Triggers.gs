/**
 * Triggers.gs — 시간 기반 자동 실행.
 *
 * 트리거는 코드에 있다고 도는 게 아니라 프로젝트에 등록되어야 한다.
 * installTriggers() 를 한 번 실행하면 아래가 자동으로 돈다.
 *
 *   1분마다   발송 큐 처리
 *   매일 새벽 명부 동기화
 *   매월 1일  출석부 재생성
 *   시트 편집 출석부 연/월이 바뀌면 재생성
 */

var TRIGGER_HANDLERS = [
  'processMessageQueue',
  'dailySync',
  'monthlyRebuild',
  'hourlyCatchUp',
  'onSheetEdit',
  // 한 번 돌고 스스로 사라지지만, 중간에 멎었으면 여기서 걷어낸다
  'ipTrialRun'
];

/**
 * 트리거를 설치한다. 여러 번 실행해도 중복되지 않는다.
 * @return {string} 리포트
 */
function installTriggers() {
  var removed = removeTriggers_();
  var ss = ss_();

  ScriptApp.newTrigger('processMessageQueue').timeBased().everyMinutes(1).create();
  ScriptApp.newTrigger('dailySync').timeBased().atHour(4).everyDays(1).create();
  ScriptApp.newTrigger('monthlyRebuild').timeBased().onMonthDay(1).atHour(5).create();
  ScriptApp.newTrigger('hourlyCatchUp').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('onSheetEdit').forSpreadsheet(ss).onEdit().create();

  return [
    '[트리거 설치]',
    (removed ? '  기존 트리거 ' + removed + '개 제거\n' : '') +
    '  1분마다   · 발송 큐 처리',
    '  매일 04시 · 명부 동기화',
    '  매월 1일 05시 · 출석부 재생성',
    '  1시간마다 · 새 학생 따라잡기 (출석부 · 수강료 이월)',
    '  시트 편집 · 출석부 연/월 변경 감지'
  ].join('\n');
}

/** 이 프로젝트가 만든 트리거를 모두 지운다. */
function removeTriggers_() {
  var count = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1) {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  return count;
}

/** 트리거를 모두 끈다. */
function uninstallTriggers() {
  var n = removeTriggers_();
  return '[트리거 해제] ' + n + '개를 제거했습니다.';
}

/* ── 핸들러 ───────────────────────────────────────────────────────── */

/** 매일 새벽 명부를 맞춘다. 신규·퇴소가 자동 반영된다. */
function dailySync() {
  try {
    var res = syncRoster();
    Logger.log(res.report);
  } catch (e) {
    Logger.log('명부 동기화 실패: ' + e.message);
  }
}

/** 매월 1일 새 달 출석부를 그린다. */
function monthlyRebuild() {
  try {
    var now = now_();
    var res = rebuildAttendbook(now.getFullYear(), now.getMonth() + 1);
    Logger.log(res.report);
  } catch (e) {
    Logger.log('출석부 재생성 실패: ' + e.message);
  }
}

/**
 * 출석부의 연도·수강월 셀이 바뀌면 그 달로 다시 그린다.
 *
 * 값은 원장에서 복원되므로 기록이 사라지지 않는다.
 * 다른 셀 편집에는 반응하지 않는다.
 */
function onSheetEdit(e) {
  if (!e || !e.range) return;
  try {
    applyProbedLayout_();
    var sheet = e.range.getSheet();

    // 설정을 고치면 캐시(6분)를 기다리지 않고 바로 반영한다
    if (sheet.getName() === APP_SHEET.설정) {
      clearSettingsCache_();
      return;
    }

    if (sheet.getName() !== SHEET.출석부) return;

    var edited = e.range.getA1Notation();
    var watched = [BOOK_LAYOUT.yearCell, BOOK_LAYOUT.monthCell];
    if (watched.indexOf(edited) === -1) return;

    var ym = getBookYearMonth_();
    if (!ym) return;

    var res = rebuildAttendbook(ym.year, ym.month);
    Logger.log(res.report);
  } catch (err) {
    Logger.log('연/월 변경 처리 실패: ' + err.message);
  }
}

/** 지금 설치된 트리거를 보여준다. */
function listTriggers() {
  var mine = ScriptApp.getProjectTriggers().filter(function (t) {
    return TRIGGER_HANDLERS.indexOf(t.getHandlerFunction()) !== -1;
  });
  if (!mine.length) {
    return '설치된 트리거가 없습니다. [설치·설정 > 자동 실행 켜기] 를 눌러주세요.';
  }
  var lines = ['[설치된 트리거]'];
  mine.forEach(function (t) {
    lines.push('  · ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')');
  });
  return lines.join('\n');
}
