#!/usr/bin/env node
/**
 * push 전 파일 이름 검사.
 *
 * Apps Script 는 확장자를 뺀 이름으로 파일을 식별한다.
 * Admin.gs 와 Admin.html 이 같이 있으면 push 가 통째로 거부된다.
 *   → "A file with this name already exists in the current project: Admin"
 *
 * 올리고 나서 알면 늦으니 여기서 먼저 막는다.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'src');
const C = {
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
};

const files = fs.readdirSync(SRC).filter((f) => /\.(gs|html)$/.test(f));

const byBase = {};
files.forEach((f) => {
  const base = f.replace(/\.(gs|html)$/, '');
  (byBase[base] = byBase[base] || []).push(f);
});

const clashes = Object.keys(byBase).filter((b) => byBase[b].length > 1);

if (clashes.length) {
  console.log('');
  console.log(C.red('  파일 이름이 겹칩니다. Apps Script 는 확장자를 빼고 이름을 봅니다.'));
  console.log('');
  clashes.forEach((b) => {
    console.log('    ' + C.red(b) + ' ← ' + byBase[b].join(' , '));
  });
  console.log('');
  console.log(C.dim('  이대로 push 하면 다음 오류로 전부 실패합니다:'));
  console.log(C.dim('    A file with this name already exists in the current project: ' + clashes[0]));
  console.log(C.dim('  한쪽 이름을 바꿔주세요. 예: Admin.gs → AdminApi.gs'));
  console.log('');
  process.exit(1);
}

console.log(C.green(`  파일 이름 검사 통과 (${files.length}개)`));
