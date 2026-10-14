import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 依赖方向：站点（site/）可以 import 服务端与 src/shared 的代码，服务端不 import 站点。
// 两边都要的纯函数放 src/shared/（如 remark-pinpoint.js、refs.js）。
const SERVER = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(SERVER, '..', '..', 'site');

function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(m?js|jsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const SPECIFIER_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"]([^'"]+)['"]/g;

test('src/server 不 import site/ 下的代码', () => {
  const offenders = [];
  for (const file of sourceFiles(SERVER)) {
    for (const [, spec] of fs.readFileSync(file, 'utf8').matchAll(SPECIFIER_RE)) {
      if (!spec.startsWith('.')) continue;
      const target = path.resolve(path.dirname(file), spec);
      if (target === SITE || target.startsWith(SITE + path.sep)) offenders.push(`${path.relative(SERVER, file)} → ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});
