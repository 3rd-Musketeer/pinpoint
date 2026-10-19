import test from 'node:test';
import assert from 'node:assert/strict';

// S2/F2：整板装载与按屏重摆共用的单屏内层 HTML（screenContentHtml）。两条路
// 画出来必须一样 —— 重摆出的屏和整板装载的屏同构，锚点归一才成立。
test('screenContentHtml：拉取成功套机壳，失败出带重试契约的面板', async (t) => {
  const { screenContentHtml } = await import('./screen-load.js');
  const sc = { id: 'home', shell: 'app' };
  const ok = screenContentHtml('p', sc, { ok: true, html: '<div class="ios-app">v2</div>' }, 'window');
  assert.match(ok, /class="ios-stage"/);
  assert.match(ok, /<div class="ios-app">v2<\/div>/);
  // doc 屏在手机视口下套手机壳（与整板装载同一分派）。
  assert.match(
    screenContentHtml('p', { id: 'doc1', shell: 'doc' }, { ok: true, html: '<iframe></iframe>' }, 'phone'),
    /wb-phone-doc/
  );
  const fail = screenContentHtml('p', sc, { ok: false, err: 500 }, 'window');
  assert.match(fail, /wb-screen-err/);
  assert.match(fail, /data-err-retry="screen" data-err-page="p" data-err-screen="home"/);
  // 没拉到（res 缺席）也是错误面板，不出空白。
  assert.match(screenContentHtml('p', sc, undefined, 'window'), /wb-screen-err/);
});
