/**
 * Sync.gs — 명단 3종(수강생/휴원생/퇴소생) → _출결_학생 동기화.
 *
 * 설계상 중요한 두 가지:
 *
 * 1) 수강생명단은 읽기 전용이다. 이름 열을 고치면 수강료 시트들의
 *    이름 기반 수식이 깨지므로, 동명이인 표시명은 _출결_학생 에만 둔다.
 *
 * 2) _출결_학생 은 행을 절대 삭제하지 않는다. 퇴소해도 상태만 바꾼다.
 *    이 시트가 동명이인 접미사 대장을 겸하기 때문에, 행이 지워지면
 *    접미사가 재사용되어 출결 이력이 다른 학생에게 옮겨붙는다.
 */

/* ── 매칭 키 ──────────────────────────────────────────────────────── */

/** 1차 키: 이름 + 등록일 */
function matchKey1_(name, regDate) {
  return name + '|' + (regDate ? fmtDate_(regDate) : '');
}

/** 2차 키: 이름 + 등록일 + 보호자 연락처 */
function matchKey2_(name, regDate, phone) {
  return matchKey1_(name, regDate) + '|' + (phone || '');
}

/* ── 접미사 대장 ──────────────────────────────────────────────────── */

/**
 * 기존 학생들에서 "기본이름 → 이미 쓰인 접미사 목록" 을 만든다.
 * 퇴소·휴원 학생도 포함해야 접미사가 재사용되지 않는다.
 */
function buildSuffixLedger_(students) {
  var ledger = {};
  students.forEach(function (s) {
    var parts = splitDisplayName_(s.표시명 || s.이름);
    var base = s.이름 || parts.base;
    if (!ledger[base]) ledger[base] = [];
    ledger[base].push(parts.suffix);
  });
  return ledger;
}

/**
 * 새 학생에게 표시명을 발급한다.
 * 첫 번째면 접미사 없음, 이후로는 A, B, C … (재사용하지 않는다)
 */
function assignDisplayName_(name, ledger) {
  var used = ledger[name] || [];
  var suffix = nextSuffix_(used);
  if (!ledger[name]) ledger[name] = [];
  ledger[name].push(suffix);
  return makeDisplayName_(name, suffix);
}

/* ── 명단 3종 병합 ────────────────────────────────────────────────── */

/**
 * 이 학원의 실제 운영 방식은 다음과 같다.
 *
 *   퇴소  수강생명단 → 퇴소생명단 으로 **이동**한다.
 *         따라서 두 시트에 동시에 있으면 규칙 위반이고 경고 대상이다.
 *
 *   휴원  휴원생명단은 **이력 시트**다. 휴원 기간을 기록할 뿐이라
 *         수강생명단에 그대로 남아 있는 것이 정상이며,
 *         여러 번 휴원한 학생은 여러 행을 가질 수 있다.
 *
 * 그래서 "지금 휴원 중인가" 는 시트에 있느냐가 아니라
 * 오늘 날짜가 휴원 구간 안에 들어 있느냐로 판정한다.
 */

/**
 * 휴원 구간 중 하나라도 기준일을 포함하는지.
 * 종료일이 비어 있으면 아직 복귀하지 않은 무기한 휴원으로 본다.
 *
 * @param {Array<{시작: Date, 종료: Date}>} spans
 * @param {Date} at 기준일
 */
function isOnLeaveAt_(spans, at) {
  if (!spans || !spans.length) return false;
  var t = at.getTime();
  for (var i = 0; i < spans.length; i++) {
    var s = spans[i].시작;
    if (!s || startOfDay_(s).getTime() > t) continue;
    var e = spans[i].종료;
    // 종료일 당일까지는 휴원으로 본다 (복귀는 다음 날)
    if (!e || endOfDay_(e).getTime() >= t) return true;
  }
  return false;
}

/**
 * 휴원 구간 중 하나라도 [from, to] 를 통째로 덮는지.
 * 월 전체가 휴원이면 그 달 출석부에서 빠져야 한다.
 */
function leaveCoversRange_(spans, from, to) {
  if (!spans || !spans.length) return false;
  for (var i = 0; i < spans.length; i++) {
    var s = spans[i].시작;
    if (!s || startOfDay_(s).getTime() > from.getTime()) continue;
    var e = spans[i].종료;
    // '4월 30일 종료' 는 4월을 통째로 덮는다. 시각 없이 비교하면 놓친다.
    if (!e || endOfDay_(e).getTime() >= to.getTime()) return true;
  }
  return false;
}

/**
 * 명단 3종을 읽어 하나의 목록으로 만든다.
 * syncRoster() 와 Attendbook 이 같은 판정을 쓰도록 여기 한 곳에 모은다.
 *
 * 순서는 수강생명단 → 휴원생명단 전용 → 퇴소생명단 순이다.
 * 출석부 행 순서가 매번 흔들리지 않도록 입력 순서를 유지한다.
 *
 * @param {string[]=} warnings 경고를 담을 배열 (선택)
 * @return {Array} 상태·휴원구간·퇴소일이 붙은 명단
 */
function readMergedRoster_(warnings) {
  var warn = warnings || [];
  var active = readActiveRoster_();
  var leaves = readLeaveRoster_();
  var quits = readQuitRoster_();
  var today = now_();

  // 휴원 구간을 (이름, 등록일) 별로 모은다. 여러 번 휴원했으면 여러 개다.
  var spans = {};
  leaves.forEach(function (r) {
    var k = matchKey1_(r.이름, r.등록일);
    (spans[k] = spans[k] || []).push({ 시작: r.휴원시작일, 종료: r.휴원종료일 });
  });

  var quitByKey = {};
  quits.forEach(function (r) {
    var k = matchKey1_(r.이름, r.등록일);
    if (quitByKey[k]) {
      warn.push('퇴소생명단에 "' + r.이름 + '" (등록일 ' +
        (r.등록일 ? fmtDate_(r.등록일) : '없음') + ') 이 두 번 있습니다.');
      return;
    }
    quitByKey[k] = r;
  });

  var out = [];
  var seen = {};

  function emit(base, status, key) {
    var rec = {
      이름: base.이름,
      과목: base.과목,
      보호자연락처: base.보호자연락처,
      등록일: base.등록일,
      메모: base.메모 || '',
      행: base.행,
      상태: status,
      휴원구간: spans[key] || [],
      퇴소일: quitByKey[key] ? quitByKey[key].퇴소일 : null
    };
    out.push(rec);
    return rec;
  }

  // 1) 수강생명단 — 순서를 그대로 유지한다
  active.forEach(function (r) {
    var k = matchKey1_(r.이름, r.등록일);
    if (seen[k]) {
      warn.push('수강생명단에 "' + r.이름 + '" (등록일 ' +
        (r.등록일 ? fmtDate_(r.등록일) : '없음') + ') 이 두 번 있습니다. 확인해주세요.');
      return;
    }
    seen[k] = true;

    if (quitByKey[k]) {
      // 퇴소는 '이동' 이므로 두 시트에 동시에 있으면 규칙 위반이다
      warn.push('"' + r.이름 + '" 이 수강생명단과 퇴소생명단에 동시에 있습니다. ' +
        '퇴소로 처리했습니다. 수강생명단에서 해당 행을 삭제해주세요.');
      emit(r, ST.퇴소, k);
      return;
    }

    // 휴원생명단에 있어도 수강생명단에 남는 것이 정상이다.
    // 오늘이 휴원 구간 안이면 휴원, 아니면 재원(복귀했거나 예정)이다.
    emit(r, isOnLeaveAt_(spans[k], today) ? ST.휴원 : ST.재원, k);
  });

  // 2) 수강생명단에서 빠진 채 휴원생명단에만 있는 사람
  leaves.forEach(function (r) {
    var k = matchKey1_(r.이름, r.등록일);
    if (seen[k]) return;
    seen[k] = true;
    if (quitByKey[k]) { emit(quitByKey[k], ST.퇴소, k); return; }
    emit(r, ST.휴원, k);
  });

  // 3) 퇴소생명단
  quits.forEach(function (r) {
    var k = matchKey1_(r.이름, r.등록일);
    if (seen[k]) return;
    seen[k] = true;
    emit(r, ST.퇴소, k);
  });

  return out;
}

/* ── 동기화 본체 ──────────────────────────────────────────────────── */

/**
 * 명단 3종을 읽어 _출결_학생 을 갱신한다.
 * 여러 번 실행해도 결과가 같다(멱등).
 *
 * @return {{report: string, added: number, updated: number, warnings: string[]}}
 */
function syncRoster() {
  applyProbedLayout_();

  return withLock_(function () {
    var warnings = [];
    var incoming = readMergedRoster_(warnings);
    var existing = readStudents_();

    var active = incoming.filter(function (r) { return r.상태 === ST.재원; });
    var onLeave = incoming.filter(function (r) { return r.상태 === ST.휴원; });
    var quit = incoming.filter(function (r) { return r.상태 === ST.퇴소; });

    var added = 0;
    var updated = 0;

    // 기존 학생을 매칭 키로 색인한다.
    var byKey1 = {};
    var byKey2 = {};
    existing.forEach(function (s) {
      var k1 = matchKey1_(s.이름, s.등록일);
      var k2 = matchKey2_(s.이름, s.등록일, s.보호자연락처);
      (byKey1[k1] = byKey1[k1] || []).push(s);
      (byKey2[k2] = byKey2[k2] || []).push(s);
    });

    var ledger = buildSuffixLedger_(existing);
    var claimed = {};   // 이번 실행에서 이미 짝지어진 학생ID

    /**
     * 명단 한 줄에 대응하는 기존 학생을 찾는다.
     * 1) (이름, 등록일)  2) + 보호자 연락처  3) 실패 → null
     */
    function findExisting(rec) {
      var k1 = matchKey1_(rec.이름, rec.등록일);
      var c1 = (byKey1[k1] || []).filter(function (s) { return !claimed[s.학생ID]; });
      if (c1.length === 1) return c1[0];
      if (c1.length === 0) return null;

      var k2 = matchKey2_(rec.이름, rec.등록일, rec.보호자연락처);
      var c2 = (byKey2[k2] || []).filter(function (s) { return !claimed[s.학생ID]; });
      if (c2.length === 1) return c2[0];

      // 세 키가 모두 같은 진짜 동명이인. 아직 짝지어지지 않은 첫 후보와 잇는다.
      //
      // 여기서 null 을 돌려주면 동기화를 돌릴 때마다 학생이 새로 생겨
      // 멱등성이 깨진다. 명단 순서는 안정적이므로 순서대로 잇는 것이
      // 결정적이면서 안전하다. 다만 사람이 한 번은 확인해야 하므로 경고를 남긴다.
      var pool = c2.length ? c2 : c1;
      warnings.push(
        '"' + rec.이름 + '" (등록일 ' + (rec.등록일 ? fmtDate_(rec.등록일) : '없음') +
        ') 이 이름·등록일·연락처가 모두 같은 학생 ' + pool.length + '명과 일치합니다. ' +
        '명단 순서대로 "' + (pool[0].표시명 || pool[0].이름) + '" 에 연결했습니다. ' +
        '관리자 화면에서 확인해주세요.'
      );
      return pool[0];
    }

    var nextId = nextStudentId_(existing);
    var result = existing.slice();

    incoming.forEach(function (rec) {
      var hit = findExisting(rec);

      if (hit) {
        claimed[hit.학생ID] = true;
        var before = JSON.stringify([hit.과목, hit.보호자연락처, hit.상태]);

        // 수강생명단이 원본이므로 덮어쓴다. 표시명·PIN·알림수신은 앱 소유라 유지한다.
        hit.과목 = rec.과목 || hit.과목;
        hit.보호자연락처 = rec.보호자연락처 || hit.보호자연락처;
        hit.등록일 = rec.등록일 || hit.등록일;
        hit.상태 = rec.상태;
        if (!hit.표시명) hit.표시명 = hit.이름;

        if (JSON.stringify([hit.과목, hit.보호자연락처, hit.상태]) !== before) updated++;
        return;
      }

      // 신규 학생
      var display;
      try {
        display = assignDisplayName_(rec.이름, ledger);
      } catch (e) {
        warnings.push('"' + rec.이름 + '": ' + e.message);
        return;
      }

      var student = {
        학생ID: nextId,
        이름: rec.이름,
        표시명: display,
        과목: rec.과목,
        등록일: rec.등록일,
        보호자연락처: rec.보호자연락처,
        // 성인반은 보호자 알림이 필요 없으므로 기본 OFF
        알림수신: !isAdultSubject_(rec.과목),
        PIN: '',
        출석부행: '',
        상태: rec.상태
      };
      result.push(student);
      claimed[nextId] = true;
      nextId = formatSeqId_('S', parseSeqId_('S', nextId) + 1, 3);
      added++;

      if (display !== rec.이름) {
        warnings.push(
          '동명이인 발생: "' + rec.이름 + '" → 표시명 "' + display + '" 로 발급했습니다. ' +
          '출석부에도 같은 표기를 반영해주세요.'
        );
      }
    });

    // 명단 어디에도 없는데 재원으로 남아 있는 학생 → 확인필요
    result.forEach(function (s) {
      if (!claimed[s.학생ID] && s.상태 !== ST.확인필요 && s.상태 !== ST.퇴소) {
        s.상태 = ST.확인필요;
        warnings.push(
          '"' + (s.표시명 || s.이름) + '" 이 명단 3종 어디에도 없습니다. 상태를 확인필요로 바꿨습니다.'
        );
      }
    });

    writeStudents_(result);
    CacheService.getScriptCache().remove('roster');

    var lines = [
      '[명부 동기화]',
      '  수강생 ' + active.length + '명 · 휴원 ' + onLeave.length + '명 · 퇴소 ' + quit.length + '명',
      '  신규 ' + added + '명, 갱신 ' + updated + '명, 전체 ' + result.length + '명',
      '  연락처 미등록 ' + countMissingPhone_(result) + '명',
      '  알림수신 OFF ' + result.filter(function (s) {
        return s.상태 === ST.재원 && !s.알림수신;
      }).length + '명'
    ];
    if (warnings.length) {
      lines.push('');
      lines.push('[확인 필요]');
      warnings.forEach(function (w) { lines.push('  · ' + w); });
    }

    return {
      report: lines.join('\n'),
      added: added,
      updated: updated,
      total: result.length,
      warnings: warnings
    };
  });
}

/** 재원생 중 보호자 연락처가 없는 인원 수 */
function countMissingPhone_(students) {
  return students.filter(function (s) {
    return s.상태 === ST.재원 && !s.보호자연락처;
  }).length;
}

/* ── 명부 조회 (앱이 쓰는 진입점) ─────────────────────────────────── */

/**
 * 태블릿 앱에 내려줄 재원생 명부.
 * 69명이면 JSON 약 8KB 라 통째로 보내고 검색·정렬은 클라이언트가 한다.
 *
 * @return {{version: string, students: Array}}
 */
function getRoster() {
  applyProbedLayout_();

  var cache = CacheService.getScriptCache();
  var hit = cache.get('roster');
  if (hit) return JSON.parse(hit);

  // 휴원생도 내려준다. 복귀 첫날처럼 갑자기 오는 경우가 있고,
  // 그때 명부에 없으면 기록할 방법이 없다.
  var students = readStudents_().filter(function (s) {
    return s.상태 === ST.재원 || s.상태 === ST.휴원;
  });

  var payload = {
    version: fmtStamp_(now_()),
    students: students.map(function (s) {
      var display = s.표시명 || s.이름;
      var subjects = splitSubjects_(s.과목).filter(function (x) { return !!x; });
      return {
        id: s.학생ID,
        name: display,
        chosung: getChosung_(display),
        subject: s.과목,
        subjects: subjects.length > 1 ? subjects : [],   // 복수 과목일 때만 고르게 한다
        status: s.상태,
        onLeave: s.상태 === ST.휴원,
        hasPhone: !!s.보호자연락처,
        phoneMasked: maskPhone_(s.보호자연락처),
        notify: s.알림수신,
        hasPin: !!s.PIN
      };
    })
  };

  cache.put('roster', JSON.stringify(payload), 21600); // 6시간
  return payload;
}

/** 명부 캐시를 버린다. 학생 정보를 바꾼 뒤 호출한다. */
function clearRosterCache_() {
  CacheService.getScriptCache().remove('roster');
}

/**
 * 앱에서 보호자 연락처를 입력했을 때.
 * 원본인 수강생명단 I열에 쓰고 _출결_학생 에도 반영한다.
 *
 * @param {string} studentId
 * @param {string} phone
 * @return {{ok: boolean, message: string}}
 */
function saveGuardianPhone(studentId, phone) {
  applyProbedLayout_();

  var normalized = normalizePhone_(phone);
  if (!normalized) {
    return { ok: false, message: '전화번호 형식이 올바르지 않습니다.' };
  }

  return withLock_(function () {
    var students = readStudents_();
    var target = null;
    for (var i = 0; i < students.length; i++) {
      if (students[i].학생ID === studentId) { target = students[i]; break; }
    }
    if (!target) return { ok: false, message: '학생을 찾을 수 없습니다.' };

    // 원본(수강생명단)에서 해당 행을 찾아 쓴다
    var roster = readActiveRoster_();
    var rosterRow = null;
    for (var j = 0; j < roster.length; j++) {
      if (roster[j].이름 === target.이름 &&
          matchKey1_(roster[j].이름, roster[j].등록일) === matchKey1_(target.이름, target.등록일)) {
        rosterRow = roster[j].행;
        break;
      }
    }
    if (rosterRow) {
      writeRosterPhone_(rosterRow, normalized);
    }

    var before = target.보호자연락처;
    updateStudentCell_(target.행, STUDENT_COL.보호자연락처, formatPhone_(normalized));

    appendHistory_({
      대상기록ID: studentId,
      작업: '연락처입력',
      필드: '보호자연락처',
      이전값: before ? maskPhone_(before) : '(없음)',
      이후값: maskPhone_(normalized),
      수행자: '앱',
      사유: rosterRow ? '수강생명단 ' + rosterRow + '행에도 반영' : '수강생명단 행을 찾지 못해 앱 시트만 갱신'
    });

    clearRosterCache_();
    return {
      ok: true,
      message: rosterRow
        ? '저장했습니다. 수강생명단에도 반영했습니다.'
        : '저장했습니다. 다만 수강생명단에서 해당 행을 찾지 못해 앱에만 반영했습니다.'
    };
  });
}
