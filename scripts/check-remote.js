#!/usr/bin/env node
/**
 * push 전에 "원격에만 있는 파일" 을 찾아 막는다.
 *
 * clasp push 는 프로젝트를 로컬 src/ 와 똑같이 맞춘다. 로컬에 없는 파일은
 * 조용히 지워진다. 우리가 붙은 스프레드시트는 시판 템플릿이라 원래
 * 딸려 있던 매크로가 있었는데, 첫 push 때 그게 통째로 사라졌다
 * (수강료 이월 매크로 copyScheduleToLog 등).
 *
 * 사람이 Apps Script 편집기에서 직접 만든 파일도 마찬가지로 날아간다.
 * 그래서 push 하기 전에 원격을 한 번 보고, 로컬에 없는 파일이 있으면 멈춘다.
 *
 * 지우는 게 맞는 경우(파일 이름을 바꿨다든가)에는:
 *   npm run push -- --allow-delete
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const C = {
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
};

if (process.argv.indexOf('--allow-delete') !== -1) {
  console.log(C.yellow('  ! 원격 전용 파일 검사를 건너뜁니다 (--allow-delete)'));
  process.exit(0);
}

/** 확장자를 뗀 이름. Apps Script 는 이 이름으로 파일을 식별한다. */
const baseOf = (f) => f.replace(/\.(gs|js|html|json)$/, '');

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.clasp.json'), 'utf8'));
} catch (e) {
  console.log(C.red('  .clasp.json 을 읽을 수 없습니다: ' + e.message));
  process.exit(1);
}
if (!cfg.scriptId) {
  console.log(C.red('  .clasp.json 에 scriptId 가 없습니다.'));
  process.exit(1);
}

const srcDir = path.join(ROOT, cfg.rootDir || 'src');
const localBases = new Set(
  fs.readdirSync(srcDir)
    .filter((f) => /\.(gs|html|json)$/.test(f))
    .map(baseOf)
);

// 원격을 임시 폴더로 받아 본다. pull 은 원격을 바꾸지 않는다.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clasp-remote-'));
fs.mkdirSync(path.join(tmp, 'src'));
fs.writeFileSync(
  path.join(tmp, '.clasp.json'),
  JSON.stringify({ scriptId: cfg.scriptId, rootDir: 'src' })
);

// 임시 폴더에는 node_modules 가 없다. 이 저장소에 설치된 clasp 를 node 로 직접 부른다.
// .bin 래퍼(clasp.cmd)를 쓰면 셸을 거쳐야 해서 경로 인용 문제가 생긴다.
const claspJs = path.join(ROOT, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');

let remote;
try {
  execFileSync(process.execPath, [claspJs, 'pull'], {
    cwd: tmp, encoding: 'utf8', stdio: 'pipe',
  });
  remote = fs.readdirSync(path.join(tmp, 'src'))
    .filter((f) => /\.(gs|js|html|json)$/.test(f));
} catch (e) {
  console.log(C.red('  원격 파일 목록을 가져오지 못했습니다.'));
  console.log(C.dim('  ' + String(e.stderr || e.message).trim().split('\n').slice(-3).join('\n  ')));
  console.log(C.dim('  로그인이 풀렸다면 npm run login 을 먼저 실행하세요.'));
  console.log(C.dim('  검사를 건너뛰려면 npm run push -- --allow-delete'));
  process.exit(1);
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* 무시 */ }
}

const orphan = remote.filter((f) => !localBases.has(baseOf(f)));

if (orphan.length) {
  console.log('');
  console.log(C.red('  원격에만 있는 파일이 ' + orphan.length + '개 있습니다. push 하면 지워집니다.'));
  console.log('');
  orphan.forEach((f) => console.log('    ' + C.red(baseOf(f))));
  console.log('');
  console.log(C.dim('  Apps Script 편집기에서 직접 만든 파일이거나,'));
  console.log(C.dim('  스프레드시트 템플릿에 딸려 온 매크로일 수 있습니다.'));
  console.log('');
  console.log(C.dim('  남기려면 그 내용을 src/ 에 파일로 옮긴 뒤 다시 push 하세요.'));
  console.log(C.dim('  지우는 게 맞다면: npm run push -- --allow-delete'));
  console.log('');
  process.exit(1);
}

console.log(C.green(`  원격 전용 파일 없음 (원격 ${remote.length}개)`));
