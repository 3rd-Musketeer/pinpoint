import assert from 'node:assert/strict';
import test from 'node:test';

import { annotateInjection, annotateSnippet, injectAnnotateClient } from './annotate-snippet.js';

// S3（r2 D4）：?annotate=off 与「登记过才注入」判定的唯一入口。此前
// sites-api 三处、preview-inject、article-proxy、content-routes 各抄一份。
test('annotateInjection：登记过且无 off 才注入；off 与未登记都返回 null', () => {
  const inject = annotateInjection({ url: '/sites/site/index.html' }, 'site');
  assert.equal(typeof inject, 'function');
  const html = '<!doctype html><html><body><p>x</p></body></html>';
  assert.ok(inject(html).includes("window.__pinpointEntry='site'"), '注入带 entry 标记');
  assert.ok(inject(html).endsWith('</body></html>'), '注入进 </body> 前');

  // 未登记（entryId 空）：不注入。article-proxy 的 entry 为 null 落在这里。
  assert.equal(annotateInjection({ url: '/x' }, null), null);
  assert.equal(annotateInjection({ url: '/x' }, ''), null);

  // ?annotate=off：单请求豁免（导出管线、工作台 fragment 装载）。
  assert.equal(annotateInjection({ url: '/sites/site/index.html?annotate=off' }, 'site'), null);
  // off 和未登记同时成立也只答不注入。
  assert.equal(annotateInjection({ url: '/x?annotate=off' }, null), null);
  // 其他 query 参数不打扰判定。
  assert.equal(typeof annotateInjection({ url: '/x?a=1&annotate=on&b=2' }, 'site'), 'function');
});

test('annotateInjection：prose 形态透传给注入', () => {
  const inject = annotateInjection({ url: '/demo/flow/' }, 'demo_flow', { prose: { project: 'demo', article: 'flow' } });
  assert.ok(inject('<p>x</p>').includes('window.__pinpointProse='));
});

test('annotateSnippet / injectAnnotateClient：注入契约本身不动', () => {
  assert.match(annotateSnippet('e1'), /<script>window\.__pinpointEntry='e1'<\/script><script src="\/annotate\./);
  assert.equal(
    injectAnnotateClient('<html><body>x</body></html>', 'e1'),
    `<html><body>x${annotateSnippet('e1')}\n</body></html>`,
  );
});
