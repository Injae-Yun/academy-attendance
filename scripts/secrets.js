#!/usr/bin/env node
/*
 * .env 의 발송 인증정보를 Apps Script 에 넣을 한 줄로 바꿔 클립보드에 담는다.
 *
 * Apps Script 에는 .env 가 없다. 실행 중인 코드가 읽는 곳은 Script Properties
 * 하나뿐이고, 거기에 넣는 길은 편집기에서 setProviderSecrets 를 한 번 돌리는
 * 것이다. 그 한 줄을 손으로 조립하다 보면 키가 터미널 기록과 채팅에 남는다.
 *
 * 그래서 키는 화면에 찍지 않는다. 클립보드로만 건네고, 여기서는 앞뒤 몇 자만
 * 보여준다. 붙여넣고 실행한 뒤에는 편집기의 그 줄을 지우면 된다.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const OFF = '\x1b[0m';

function die(msg, hint) {
  console.error(`${RED}  ${msg}${OFF}`);
  if (hint) console.error(`${DIM}  ${hint}${OFF}`);
  process.exit(1);
}

/** KEY=VALUE 만 읽는다. 따옴표와 주석은 걷어낸다. */
function parseEnv(text) {
  const out = {};
  text.split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const i = t.indexOf('=');
    if (i === -1) return;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[t.slice(0, i).trim()] = v;
  });
  return out;
}

/** 앞뒤만 남긴다. 붙여넣은 게 맞는지 확인할 만큼만. */
function mask(v) {
  if (v.length <= 8) return '*'.repeat(v.length) + ` (${v.length}자)`;
  return `${v.slice(0, 4)}…${v.slice(-4)} (${v.length}자)`;
}

/** 화면을 거치지 않고 건넨다. */
function toClipboard(text) {
  const tries = process.platform === 'win32'
    ? [['clip', []]]
    : process.platform === 'darwin'
      ? [['pbcopy', []]]
      : [['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];

  for (const [cmd, args] of tries) {
    try {
      execFileSync(cmd, args, { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
      return cmd;
    } catch (e) { /* 다음 것으로 */ }
  }
  return null;
}

// prop 은 Script Properties 에 실제로 들어가는 이름이다.
// 편집기 UI 로 직접 넣을 수도 있어서 함께 알려준다.
const PROVIDERS = {
  solapi: {
    key: 'SOLAPI_API_KEY', secret: 'SOLAPI_API_SECRET', secretLabel: 'API SECRET',
    keyProp: 'SOLAPI_API_KEY', secretProp: 'SOLAPI_API_SECRET',
  },
  aligo: {
    key: 'ALIGO_API_KEY', secret: 'ALIGO_USER_ID', secretLabel: '아이디',
    keyProp: 'ALIGO_API_KEY', secretProp: 'ALIGO_USER_ID',
  },
};

if (!fs.existsSync(ENV_PATH)) {
  die('.env 가 없습니다.', 'cp .env.example .env 로 만들고 값을 채우세요.');
}

const env = parseEnv(fs.readFileSync(ENV_PATH, 'utf8'));
const provider = (env.PROVIDER || '').trim().toLowerCase();

if (!PROVIDERS[provider]) {
  die(`PROVIDER 가 solapi 또는 aligo 여야 합니다. 지금 값: ${provider || '(빈 값)'}`);
}

const spec = PROVIDERS[provider];
const key = (env[spec.key] || '').trim();
const secret = (env[spec.secret] || '').trim();

const missing = [];
if (!key) missing.push(spec.key);
if (!secret) missing.push(spec.secret);
if (missing.length) die(`.env 에 값이 비어 있습니다: ${missing.join(', ')}`);

// 따옴표가 섞이면 붙여넣은 줄이 깨진다. 여기서 걸러 준다.
[[spec.key, key], [spec.secret, secret]].forEach(([name, v]) => {
  if (/['"\\\s]/.test(v)) die(`${name} 에 따옴표나 공백이 들어 있습니다.`, '값만 남기고 다시 저장하세요.');
});

const line = `setProviderSecrets('${provider}', '${key}', '${secret}')`;
const where = toClipboard(line);

console.log('');
console.log(`  공급사   ${provider}`);
console.log(`  API KEY  ${mask(key)}`);
console.log(`  ${spec.secretLabel.padEnd(8)} ${mask(secret)}`);
console.log('');

if (where) {
  console.log(`${GREEN}  setProviderSecrets(…) 한 줄을 클립보드에 담았습니다.${OFF}`);
} else {
  console.log(`${YELLOW}  클립보드에 담지 못했습니다. 아래로 직접 만드세요.${OFF}`);
  console.log(`${DIM}    setProviderSecrets('${provider}', '<${spec.key}>', '<${spec.secret}>')${OFF}`);
}

console.log('');
console.log('  Apps Script 편집기에서:');
console.log('    1. 아무 .gs 파일 맨 아래에 이렇게 만들고');
console.log(`${DIM}         function saveKeys() {${OFF}`);
console.log(`${DIM}           <여기에 붙여넣기>${OFF}`);
console.log(`${DIM}         }${OFF}`);
console.log('    2. 함수 고르는 칸에서 saveKeys 를 골라 실행');
console.log('    3. 실행되면 saveKeys 를 통째로 지우고 저장');
console.log(`${DIM}       값은 Script Properties 에 남는다. 코드에 남길 필요가 없다.${OFF}`);
console.log('');
console.log('  코드를 건드리기 싫으면 편집기 UI 로도 됩니다:');
console.log('    ⚙ 프로젝트 설정 → 스크립트 속성 → 속성 추가');
console.log(`    ${spec.keyProp}      ← .env 의 ${spec.key}`);
console.log(`    ${spec.secretProp}   ← .env 의 ${spec.secret}`);
console.log(`${DIM}       setProviderSecrets 는 이 두 줄을 대신 넣어주는 것뿐입니다.${OFF}`);

// 비밀이 아닌 값은 시트로 간다. 어디에 무엇을 넣는지 헷갈리기 쉬워 함께 적는다.
const fromEnv = [
  ['발신번호', env.SENDER],
  ['발신프로필키', env.PFID],
  ['템플릿ID_등원', env.TEMPLATE_IN],
  ['템플릿ID_하원', env.TEMPLATE_OUT],
].filter(([, v]) => String(v || '').trim());

console.log('');
console.log('  _출결_설정 시트에 넣을 값 (비밀 아님):');
console.log(`    ${'공급사'.padEnd(14)} ${provider}`);
fromEnv.forEach(([k, v]) => console.log(`    ${k.padEnd(14)} ${v}`));

if (fromEnv.length < 4) {
  console.log('');
  console.log(`${DIM}  SENDER · PFID · TEMPLATE_IN · TEMPLATE_OUT 를 .env 에 채우면${OFF}`);
  console.log(`${DIM}  나머지도 여기에 함께 뜹니다.${OFF}`);
}
console.log('');
