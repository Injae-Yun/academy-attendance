#!/usr/bin/env node
/**
 * clasp 배포 대상 전환기.
 *
 * clasp 은 .clasp.json 하나만 읽는다. 사본과 원본을 오갈 때마다
 * scriptId 를 손으로 고치면 언젠가 반대쪽에 push 하는 사고가 난다.
 * 여기서 이름으로 등록해 두고 한 줄로 갈아끼운다.
 *
 *   node scripts/target.js set 사본 1abc...
 *   node scripts/target.js use 사본
 *   node scripts/target.js current
 *   node scripts/target.js list
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLASP = path.join(ROOT, '.clasp.json');
const TARGETS = path.join(ROOT, '.clasp.targets.json');

const C = {
  bold: (s) => `[1m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
};

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

const targets = readJson(TARGETS, {});
const clasp = readJson(CLASP, null);

/** 지금 .clasp.json 이 가리키는 대상의 이름 */
function currentName() {
  if (!clasp || !clasp.scriptId) return null;
  const hit = Object.keys(targets).find((n) => targets[n].scriptId === clasp.scriptId);
  return hit || null;
}

function short(id) {
  return id.length > 20 ? id.slice(0, 10) + '…' + id.slice(-6) : id;
}

function showCurrent() {
  if (!clasp || !clasp.scriptId) {
    console.log(C.red('.clasp.json 이 없거나 scriptId 가 비어 있습니다.'));
    return 1;
  }
  const name = currentName();
  console.log('');
  if (name) {
    const isOrig = /원본|orig|prod/i.test(name);
    const tag = isOrig ? C.red(`  ⚠  ${name}  (원본)  `) : C.green(`  ${name}  `);
    console.log('  현재 대상: ' + C.bold(tag));
  } else {
    console.log('  현재 대상: ' + C.yellow('(등록되지 않은 ID)'));
    console.log(C.dim('    node scripts/target.js set <이름> ' + clasp.scriptId));
  }
  console.log(C.dim('  scriptId: ' + clasp.scriptId));
  console.log('');
  return 0;
}

function list() {
  const names = Object.keys(targets);
  if (!names.length) {
    console.log(C.yellow('등록된 대상이 없습니다.'));
    console.log(C.dim('  node scripts/target.js set 사본 <scriptId>'));
    return 0;
  }
  const cur = currentName();
  console.log('');
  names.forEach((n) => {
    const mark = n === cur ? C.green(' ●') : '  ';
    const isOrig = /원본|orig|prod/i.test(n);
    console.log(`${mark} ${C.bold(n.padEnd(10))} ${short(targets[n].scriptId)}` +
      (isOrig ? C.red('   ← 원본') : ''));
  });
  console.log('');
  return 0;
}

function set(name, scriptId) {
  if (!name || !scriptId) {
    console.log(C.red('사용법: node scripts/target.js set <이름> <scriptId>'));
    return 1;
  }
  if (!/^[A-Za-z0-9_-]{20,}$/.test(scriptId)) {
    console.log(C.red('scriptId 형식이 이상합니다: ' + scriptId));
    console.log(C.dim('  Apps Script 편집기 > ⚙ 프로젝트 설정 > 스크립트 ID 에서 복사하세요.'));
    return 1;
  }
  targets[name] = { scriptId };
  writeJson(TARGETS, targets);
  console.log(C.green(`등록했습니다: ${name} → ${short(scriptId)}`));
  return 0;
}

function use(name) {
  if (!name) {
    console.log(C.red('사용법: node scripts/target.js use <이름>'));
    return list();
  }
  if (!targets[name]) {
    console.log(C.red(`"${name}" 은 등록되지 않았습니다.`));
    return list();
  }
  const rootDir = (clasp && clasp.rootDir) || 'src';
  writeJson(CLASP, { scriptId: targets[name].scriptId, rootDir });

  const isOrig = /원본|orig|prod/i.test(name);
  console.log('');
  console.log('  전환 완료 → ' + C.bold(isOrig ? C.red(name + ' (원본)') : C.green(name)));
  if (isOrig) {
    console.log(C.yellow('  ⚠ 원본입니다. push 하면 실제 학원 데이터에 반영됩니다.'));
  }
  console.log('');
  return 0;
}

const [cmd, a, b] = process.argv.slice(2);
let code = 0;
switch (cmd) {
  case 'set': code = set(a, b); break;
  case 'use': code = use(a); break;
  case 'list': code = list(); break;
  case 'current': case undefined: code = showCurrent(); break;
  default:
    console.log('명령: set / use / list / current');
    code = 1;
}
process.exit(code);
