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

// BACKLOG「连续 HMR 时在飞的帧请求吞掉最新一拍」（r5 同 review 建议 2）：V2 的
// 屏请求还在飞时来第二拍 V3，fetchQuery 只会搭在飞的旧班，两个调用方都停在 V2。
// fetchScreenHtml 走 fetchQueryFresh 后：在飞的那班被悄悄取消重拉，旧调用方的
// promise 被 query-core 接到新班上 —— 两边都拿到 V3。失效与时序照真实调用方
// （stage.js preview:update：先 invalidateQueries 再拉）。
test('fetchScreenHtml：连续两拍 HMR，在飞请求取消重拉，两个调用方都拿最新一拍', async () => {
  const { fetchScreenHtml } = await import('./screen-load.js');
  const { queryClient } = await import('./app/query-client.js');
  const { wbSet } = await import('./app/store.js');
  wbSet({ pageManifest: { pages: [{ id: 'race', mode: 'ios' }] } });

  var calls = [];
  var releaseV2 = () => {};
  var realFetch = globalThis.fetch;
  globalThis.fetch = function (url) {
    calls.push(String(url));
    if (calls.length === 2) {
      // 第二次（= V2 那拍）挂住，模拟「响应被扣住期间又改到 V3」。
      return new Promise(function (resolve) { releaseV2 = function () { resolve(new Response('<div class="ios-app">v2</div>', { status: 200 })); }; });
    }
    var body = calls.length >= 3 ? 'v3' : 'v1';
    return Promise.resolve(new Response('<div class="ios-app">' + body + '</div>', { status: 200 }));
  };
  try {
    // 第一拍落定：缓存里有 V1（cancelRefetch 只在 data !== undefined 时取消重拉）。
    queryClient.invalidateQueries({ queryKey: ['screen', 'race', 'home'] });
    const v1 = await fetchScreenHtml('race', { id: 'home', shell: 'app' });
    assert.match(v1.html, /v1/);

    queryClient.invalidateQueries({ queryKey: ['screen', 'race', 'home'] });
    const first = fetchScreenHtml('race', { id: 'home', shell: 'app' });   // V2 在飞
    await new Promise(function (r) { setTimeout(r, 0); });   // 让 V2 班起飞（fetchStatus = fetching），但不放行
    queryClient.invalidateQueries({ queryKey: ['screen', 'race', 'home'] });
    const second = fetchScreenHtml('race', { id: 'home', shell: 'app' });  // V3 这拍：取消 V2 重拉
    releaseV2();
    const [r1, r2] = await Promise.all([first, second]);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.match(r1.html, /v3/);   // 放回旧实现（搭在飞旧班）这里是 v2 —— 复现断言
    assert.match(r2.html, /v3/);
    // 三次网络请求：V1、被取消的 V2、重拉的 V3。重拉后不再有第四次。
    assert.equal(calls.length, 3);
  } finally {
    globalThis.fetch = realFetch;
    // gcTime 的缓存定时器会把 node --test 的进程吊住，用完即清。
    queryClient.removeQueries({ queryKey: ['screen', 'race', 'home'] });
  }
});
