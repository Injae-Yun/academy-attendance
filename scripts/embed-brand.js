#!/usr/bin/env node
/**
 * 학원 로고를 src/Brand.html 로 박아 넣는다.
 *
 * 왜 이렇게 하나:
 *   - Apps Script 는 외부 이미지를 가져오기 까다롭다. data URI 로 심는 게 확실하다.
 *   - 상표 이미지는 저장소에 올리지 않는다 → src/Brand.html 은 .gitignore 대상
 *   - 하지만 clasp 은 올려야 한다 → .claspignore 의 !*.html 에 걸려 push 된다
 *   - 파일이 없어도 앱은 그대로 돈다 → 브랜드 CSS 를 이 파일에만 둔다
 *
 * 사용법:
 *   npm run brand -- "C:/경로/로고.png"
 *   npm run brand -- --remove          로고를 걷어낸다
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'Brand.html');

const C = {
  red: (s) => `[31m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  yellow: (s) => `[33m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
};

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** Apps Script 파일 하나가 지나치게 커지면 편집기가 버거워진다. */
const WARN_KB = 250;

const arg = process.argv[2];

if (arg === '--remove') {
  if (fs.existsSync(OUT)) {
    fs.unlinkSync(OUT);
    console.log(C.green('  로고를 걷어냈습니다. 다음 push 부터 기본 화면으로 돌아갑니다.'));
    console.log(C.dim('  이미 배포된 로고를 지우려면 Apps Script 편집기에서 Brand 파일도 삭제하세요.'));
  } else {
    console.log(C.dim('  src/Brand.html 이 이미 없습니다.'));
  }
  process.exit(0);
}

if (!arg) {
  console.log('');
  console.log('  사용법: npm run brand -- "<이미지 경로>"');
  console.log(C.dim('          npm run brand -- --remove'));
  console.log('');
  console.log('  현재 상태: ' + (fs.existsSync(OUT)
    ? C.green('로고 적용됨 (' + (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB)')
    : C.dim('로고 없음 — 기본 화면')));
  console.log('');
  process.exit(0);
}

const src = path.resolve(arg);
if (!fs.existsSync(src)) {
  console.log(C.red('  파일을 찾을 수 없습니다: ' + src));
  process.exit(1);
}

const ext = path.extname(src).toLowerCase();
const mime = MIME[ext];
if (!mime) {
  console.log(C.red('  지원하지 않는 형식입니다: ' + ext));
  console.log(C.dim('  ' + Object.keys(MIME).join(' , ')));
  process.exit(1);
}

const buf = fs.readFileSync(src);
const b64 = buf.toString('base64');
const kb = (b64.length / 1024).toFixed(0);

if (b64.length / 1024 > WARN_KB) {
  console.log(C.yellow(`  ! base64 가 ${kb} KB 입니다. 편집기가 느려질 수 있습니다.`));
  console.log(C.dim('    이미지를 줄여서 다시 넣는 것을 권합니다 (가로 600px 정도면 충분합니다).'));
}

const css = `<!--
  학원 로고. scripts/embed-brand.js 가 만든 파일입니다. 직접 고치지 마세요.
  원본: ${path.basename(src)}  (${(buf.length / 1024).toFixed(0)} KB)

  이 파일은 .gitignore 대상이라 저장소에 올라가지 않습니다.
  clasp 은 .claspignore 의 !*.html 규칙으로 그대로 push 합니다.
  파일이 없으면 아래 스타일이 통째로 빠지고 앱은 기본 화면으로 돕니다.
-->
<style>
:root { --brand-mark: url("data:${mime};base64,${b64}"); }

/* 상단바의 작은 마크 */
.brand-mark {
  display: inline-block; flex: 0 0 auto;
  width: 30px; height: 30px; margin-right: 2px;
  background: var(--brand-mark) center / contain no-repeat;
}

/* 기기 등록·관리자 잠금 화면의 큰 로고 */
.panel-mark {
  display: block; width: 104px; height: 104px; margin: 0 auto 18px;
  background: var(--brand-mark) center / contain no-repeat;
}

/* 배경 워터마크.
   글자를 가리면 안 되므로 아주 옅게, 한 장만, 가운데에 둔다. */
body::before {
  content: ''; position: fixed; inset: 0; z-index: 0;
  background: var(--brand-mark) center center / min(46vmin, 380px) no-repeat;
  opacity: .05;
  pointer-events: none;
}

/* 워터마크가 본문 뒤로 가도록. 떠 있는 요소(backdrop·sheet 등)는
   이미 z-index 20 이상이라 건드리지 않는다. */
.screen { position: relative; z-index: 1; }
</style>
`;

fs.writeFileSync(OUT, css, 'utf8');

console.log('');
console.log(C.green('  로고를 심었습니다.'));
console.log('    원본   ' + src);
console.log('    출력   src/Brand.html  (' + kb + ' KB)');
console.log('');
console.log(C.dim('    · git 에는 올라가지 않습니다 (.gitignore)'));
console.log(C.dim('    · clasp push 로는 함께 올라갑니다 (.claspignore)'));
console.log(C.dim('    · 반영하려면: npm run push → 배포 관리 → 연필 → 새 버전'));
console.log('');
