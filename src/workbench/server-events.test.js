import test from 'node:test';
import assert from 'node:assert/strict';

// r3-workbench review 必须修 1 的回归测试：文章页预热嵌入工作台在 warming 阶段就
// tellFrame('pause')（pause 先于左栏挂载，embed-park 的「先记住、登记补停」路径），
// startServerEvents 停驻中登记时不得开 /events——连接的第一次开合交给 resume。
// 放回漏守卫的版本（登记后无条件 connect）：情形 A 开出 1 条连接，LEAK 断言挂。
test('startServerEvents：停驻中登记不开 /events，恢复时才开', async () => {
  var opened = [];
  class FakeES {
    constructor(url) { this.url = url; this.readyState = 0; opened.push(url); }
    addEventListener() {}
    close() { this.closed = true; }
  }
  FakeES.OPEN = 1;
  var realES = globalThis.EventSource;
  globalThis.EventSource = FakeES;
  try {
    const { startServerEvents } = await import('./server-events.js');
    const { pauseEmbed, resumeEmbed, resetEmbedPark } = await import('./embed-park.js');

    // 情形 A（回归）：pause 先到（预热停驻），再登记。
    resetEmbedPark();
    pauseEmbed(); // 还没有登记 → 只记住意图，登记时补停
    opened = [];
    var stopA = startServerEvents(function () {}, function () {});
    assert.equal(opened.length, 0, '停驻中登记开了 /events（停驻的工作台占着连接）');
    resumeEmbed();
    assert.equal(opened.length, 1, '恢复后应开且只开一条');
    stopA();

    // 情形 B（对照）：正常序（先登记后停驻）——登记时开、停驻断开、恢复重开，不叠加。
    resetEmbedPark();
    opened = [];
    var stopB = startServerEvents(function () {}, function () {});
    assert.equal(opened.length, 1);
    pauseEmbed();
    assert.equal(opened.length, 1);
    resumeEmbed();
    assert.equal(opened.length, 2);
    stopB();

    // 情形 C（对照）：停驻中登记 + resume + 再 resume，不重复开。
    resetEmbedPark();
    pauseEmbed();
    opened = [];
    var stopC = startServerEvents(function () {}, function () {});
    resumeEmbed();
    resumeEmbed();
    assert.equal(opened.length, 1);
    stopC();
  } finally {
    globalThis.EventSource = realES;
    const { resetEmbedPark } = await import('./embed-park.js');
    resetEmbedPark();
  }
});
