import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  anchorComp,
  anchorNode,
  buildCheckReport,
  collectPageRows,
  countByStatus,
  formatCheckMarkdown,
  intentOf,
  locateLine,
} from './ann-query.js';
import { elementTextOf, parseHtmlFragment } from './ann-excerpt.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-ann-query-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** e2e 形态的页：JSX 帧（用 kit 组件）+ 存量 HTML 帧 + 板。 */
function makeSite() {
  const pageDir = path.join(tmp, 'demo-page');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [
      { id: 'chat', title: '对话', layout: 'row', screens: [{ id: 'home', title: '首页' }, { id: 'old', title: '存量' }] },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(pageDir, 'home.jsx'), [
    "import { Bubble } from 'pinpoint/kit';",
    'function Card({ label }) {',              // 2
    '  return <div class="card">{label}</div>', // 3
    '}',                                        // 4
    'export default function Home() {',        // 5
    '  return (',                               // 6
    '    <div class="ios-app">',                // 7
    '      <Bubble side="incoming">早</Bubble>',// 8
    '      <p>普通段落</p>',                    // 9
    '      <Card label="卡" />',                // 10
    '    </div>',                               // 11
    '  );',                                     // 12
    '}',                                        // 13
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(pageDir, 'old.html'), [
    '<div class="ios-app">',
    '  <button class="ios-cell">存量按钮</button>',
    '</div>',
    '',
  ].join('\n'));
  const dataRoot = path.join(tmp, 'data');
  // storage-unify：画布帧标注住本页桶的 @canvas 账本（行带 pageId）。
  // selector 是真实 cssPath 形态：stage 段后缀经 frameInternalSelector 归一。
  fs.mkdirSync(path.join(dataRoot, 'demo-page'), { recursive: true });
  fs.writeFileSync(path.join(dataRoot, 'demo-page', '@canvas.json'), JSON.stringify({
    page: '@canvas', path: '@canvas', revision: 3, annotations: [
      {
        id: 'b1', n: 1, type: 'element', pageId: 'demo-page', screenId: 'home', status: 'open',
        content: '气泡文案改成「你早」 [@t:i1]',
        targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > div.ios-bubble:nth-of-type(1)', text: '早' }],
      },
      {
        id: 'b2', n: 2, type: 'element', pageId: 'demo-page', screenId: 'home', status: 'open', changeTo: '早 → 你早',
        content: '改段落 [@t:i1]',
        targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > p:nth-of-type(1)', text: '普通段落' }],
      },
      {
        id: 'b3', n: 3, type: 'element', pageId: 'demo-page', screenId: 'home', status: 'check', note: '看过，不改',
        content: '卡里的字 [@t:i1]',
        targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > div.card:nth-of-type(1)', text: '卡' }],
      },
      {
        id: 'b4', n: 4, type: 'element', pageId: 'demo-page', screenId: 'old', status: 'open',
        content: '存量按钮别用 [@t:i1]',
        targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > button.ios-cell:nth-of-type(1)', text: '存量按钮' }],
      },
    ],
  }));
  return { pageDir, dataRoot };
}

/** dist HTML 由 esbuild 真编太重：按 renumber 后的产物形态手写（结构同源：
    组件根的 data-pp-id 指向元素 JSX 字面量所在的文件 —— kit 组件指 kit 文件，
    页内 function 组件指帧文件）。 */
function distFor(screenId) {
  if (screenId === 'home') {
    return [
      '<div class="ios-app" data-pp-id="home.jsx:7@1" data-pp-comp="Home">',
      '  <div class="ios-bubble ios-bubble-in" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@1" data-pp-comp="Bubble">早</div>',
      '  <p data-pp-id="home.jsx:9@1">普通段落</p>',
      '  <div class="card" data-pp-id="home.jsx:3@1" data-pp-comp="Card">卡</div>',
      '</div>',
    ].join('\n');
  }
  if (screenId === 'old') {
    return [
      '<div class="ios-app">',
      '  <button class="ios-cell">存量按钮</button>',
      '</div>',
    ].join('\n');
  }
  return null;
}

function contextFor(site) {
  return {
    pageId: 'demo-page',
    target: { entryId: 'demo-page', pageDir: site.pageDir, urlBase: '/sites/demo-page/', kind: 'dir' },
    board: null,
    refs: { outline: [
      { id: 'chat', title: '对话', letter: 'A', frames: [
        { id: 'home', title: '首页', ref: 'A1' },
        { id: 'old', title: '存量', ref: 'A2' },
      ] },
    ], bySection: { chat: 'A' }, byFrame: { 'chat\0home': 'A1', 'chat\0old': 'A2' } },
    frameRows: collectPageRows({ root: site.dataRoot, pageId: 'demo-page' }).frameRows,
    docRows: [],
    distHtmlFor: distFor,
    readFile: (file) => fs.readFileSync(file, 'utf8'),
  };
}

describe('collectPageRows', () => {
  test('storage-unify：@canvas 账本 = 帧标注，其余账本 = 文档标注；孤儿账本跳过', () => {
    const site = makeSite();
    fs.writeFileSync(path.join(site.dataRoot, 'demo-page', 'doc~y.json'), JSON.stringify({
      page: 'doc~y', path: '/sites/demo-page/doc.html', revision: 1, annotations: [{ id: 'd1', n: 5, content: '文档意见', status: 'open' }],
    }));
    const { frameRows, docRows } = collectPageRows({ root: site.dataRoot, pageId: 'demo-page' });
    assert.equal(frameRows.length, 4);
    assert.ok(frameRows.every((row) => row.__bucket === 'demo-page' && row.__ledger === '@canvas'));
    assert.equal(docRows.length, 1);
    assert.equal(docRows[0].__bucket, 'demo-page');
    // 孤儿账本（这里直接按名字跳过；判定本身在 orphans.test.js）不进两边。
    const skipped = collectPageRows({ root: site.dataRoot, pageId: 'demo-page', skipLedgers: ['@canvas'] });
    assert.equal(skipped.frameRows.length, 0);
    assert.equal(skipped.docRows.length, 1);
  });
});

describe('anchorComp', () => {
  test('帧根不算、内层组件算', () => {
    const tree = parseHtmlFragment(distFor('home'));
    const app = tree.children[0];
    const bubble = app.children[0];
    const p = app.children[1];
    const card = app.children[2];
    assert.equal(anchorComp(app), null, '帧根的 comp 是帧自己');
    assert.equal(anchorComp(bubble), 'Bubble');
    assert.equal(anchorComp(p), null, '普通元素只有帧根祖先');
    assert.equal(anchorComp(card), 'Card');
  });
});

describe('anchorNode 决定 #15：ppId 直取，cssPath 兜底', () => {
  const homeDist = distFor('home');
  const chainOf = (tail) => `div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > ${tail}`;

  test('有 ppId 直取，cssPath 已漂也不跟错', () => {
    // 帧结构改过：存量 cssPath 指到气泡上，ppId 仍指原段落 —— locate 按段落报。
    const drifted = {
      id: 'pp1', n: 9, type: 'element', pageId: 'demo-page', screenId: 'home', status: 'open',
      content: '段落 [@t:i1]',
      targets: [{
        ref: 'i1',
        selector: chainOf('div.ios-bubble:nth-of-type(1)'),
        text: '普通段落',
        ppId: 'home.jsx:9@1',
      }],
    };
    const anchor = anchorNode(drifted, homeDist);
    assert.ok(!anchor.error, anchor.error);
    assert.equal(anchor.node.tag, 'p');
    assert.equal(anchor.node.attrs['data-pp-id'], 'home.jsx:9@1');
    assert.match(locateLine(drifted, { ...contextFor(makeSite()), distHtmlFor: distFor }).text, /#9 → home\.jsx:9/);
  });

  test('同一 ppId 多命中按文本择近', () => {
    // 防御形态：产物里出现同值（手写 dist / 未来格式），文本把「午」挑出来。
    const dup = [
      '<div class="ios-app" data-pp-id="home.jsx:4@1" data-pp-comp="Home">',
      '  <div class="ios-bubble" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@2" data-pp-comp="Bubble">早</div>',
      '  <div class="ios-bubble" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@2" data-pp-comp="Bubble">午</div>',
      '  <div class="ios-bubble" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@2" data-pp-comp="Bubble">晚</div>',
      '</div>',
    ].join('\n');
    const row = {
      id: 'pp2', n: 10, type: 'element', pageId: 'demo-page', screenId: 'home', status: 'open',
      content: '第二个气泡 [@t:i1]',
      targets: [{ ref: 'i1', selector: chainOf('div.ios-bubble:nth-of-type(2)'), text: '午', ppId: 'content/kits/ios/jsx/Bubble.jsx:17@2' }],
    };
    const anchor = anchorNode(row, dup);
    assert.ok(!anchor.error, anchor.error);
    assert.equal(elementTextOf(anchor.node, dup), '午');
  });

  test('ppId 落空回落 cssPath；两者皆空才报错', () => {
    const staleId = {
      id: 'pp3', type: 'element', pageId: 'demo-page', screenId: 'home', status: 'open',
      content: '段落 [@t:i1]',
      targets: [{ ref: 'i1', selector: chainOf('p:nth-of-type(1)'), text: '普通段落', ppId: 'home.jsx:99@7' }],
    };
    const anchor = anchorNode(staleId, homeDist);
    assert.ok(!anchor.error, anchor.error);
    assert.equal(anchor.node.tag, 'p', 'ppId 找不到时 cssPath 仍解析');
    const bothGone = anchorNode({
      targets: [{ ref: 'i1', selector: chainOf('span.gone:nth-of-type(1)'), ppId: 'home.jsx:99@7' }],
    }, homeDist);
    assert.equal(bothGone.error, '锚点在当前产物里解析不到（可能已失效）');
  });
});

describe('读侧显示序号', () => {
  test('无 n 的冷账本行显示 #?，不出 #undefined（建议 9）', () => {
    const site = makeSite();
    const context = contextFor(site);
    const cold = {
      id: 'cold1', type: 'element', pageId: 'demo-page', screenId: 'home', status: 'open',
      content: '冷账本行 [@t:i1]',
      targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > div.card:nth-of-type(1)', text: '卡' }],
    };
    const line = locateLine(cold, context);
    assert.match(line.text, /#\? → /);
    assert.ok(!line.text.includes('undefined'));
    const report = buildCheckReport({ ...context, frameRows: [cold], docRows: [] }, { status: 'all' });
    assert.ok(formatCheckMarkdown(report).join('\n').includes('[#?]'));
  });
});

describe('excerptForRow 多实例帧', () => {
  /** 一帧三个 <Bubble>：实例行按文档序取第 k 个 <Comp 匹配（S3）。 */
  function makeMultiInstanceSite() {
    const pageDir = path.join(tmp, 'multi-page');
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
      sections: [
        { id: 'chat', title: '对话', layout: 'row', screens: [{ id: 'home', title: '首页' }] },
      ],
    }, null, 2));
    fs.writeFileSync(path.join(pageDir, 'home.jsx'), [
      "import { Bubble } from 'pinpoint/kit';",
      'export default function Home() {',          // 2
      '  return (',                                 // 3
      '    <div class="ios-app">',                  // 4
      '      <Bubble side="incoming">早</Bubble>',  // 5  ← 第 1 个实例
      '      <Bubble side="incoming">午</Bubble>',  // 6  ← 第 2 个实例
      '      <Bubble side="incoming">晚</Bubble>',  // 7  ← 第 3 个实例
      '    </div>',                                 // 8
      '  );',                                       // 9
      '}',                                          // 10
      '',
    ].join('\n'));
    const dataRoot = path.join(tmp, 'multi-data', 'multi-page');
    fs.mkdirSync(dataRoot, { recursive: true });
    return { pageDir, dataRoot };
  }

  function multiRow(site, nth, text) {
    return {
      id: `m${nth}`, n: nth, type: 'element', pageId: 'multi-page', screenId: 'home', status: 'open',
      content: `${text} [@t:i1]`,
      targets: [{
        ref: 'i1',
        selector: `div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > div.ios-bubble:nth-of-type(${nth})`,
        text,
      }],
    };
  }

  test('锚第二个实例 → 实例行指向第 2 个 <Bubble，段名注明文档序', () => {
    const site = makeMultiInstanceSite();
    fs.writeFileSync(path.join(site.dataRoot, '@canvas.json'), JSON.stringify({
      page: '@canvas', path: '@canvas', revision: 1, annotations: [multiRow(site, 2, '午')],
    }));
    const context = {
      pageId: 'multi-page',
      target: { entryId: 'multi-page', pageDir: site.pageDir, urlBase: '/sites/multi-page/', kind: 'dir' },
      board: null,
      refs: { outline: [
        { id: 'chat', title: '对话', letter: 'A', frames: [{ id: 'home', title: '首页', ref: 'A1' }] },
      ], bySection: { chat: 'A' }, byFrame: { 'chat\0home': 'A1' } },
      frameRows: collectPageRows({ root: path.dirname(site.dataRoot), pageId: 'multi-page' }).frameRows,
      docRows: [],
      distHtmlFor: (screenId) => screenId === 'home' ? [
        '<div class="ios-app" data-pp-id="home.jsx:4@1" data-pp-comp="Home">',
        '  <div class="ios-bubble" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@1" data-pp-comp="Bubble">早</div>',
        '  <div class="ios-bubble" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@2" data-pp-comp="Bubble">午</div>',
        '  <div class="ios-bubble" data-pp-id="content/kits/ios/jsx/Bubble.jsx:17@3" data-pp-comp="Bubble">晚</div>',
        '</div>',
      ].join('\n') : null,
      readFile: (file) => fs.readFileSync(file, 'utf8'),
    };
    const report = buildCheckReport(context, {});
    const row = report.groups[0].rows[0];
    const excerpt = JSON.stringify(row.excerpt);
    assert.ok(excerpt.includes('home.jsx（帧内实例 · 文档序第 2 个）'), excerpt);
    // 实例段真的指到第 6 行的第 2 个 <Bubble>，不是首匹配的第 5 行。
    assert.ok(row.excerpt.some((line) => /^\s*6>.*午/.test(line)), excerpt);
    assert.ok(!row.excerpt.some((line) => /^\s*5>/.test(line)), excerpt);
  });

  test('单实例帧段名不变（回归）', () => {
    const site = makeSite();
    const context = contextFor(site);
    const report = buildCheckReport(context, {});
    const bubble = report.groups[0].rows[0];
    assert.ok(bubble.excerpt.some((line) => line.includes('home.jsx（帧内实例）')), JSON.stringify(bubble.excerpt));
  });
});

describe('buildCheckReport', () => {
  test('默认 open / 按帧分组 / 摘录带源码与组件信息', () => {
    const site = makeSite();
    const context = contextFor(site);
    const report = buildCheckReport(context, {});
    assert.deepEqual(report.groups.map((group) => group.title), ['A1 首页', 'A2 存量']);
    const homeRows = report.groups[0].rows;
    assert.deepEqual(homeRows.map((row) => row.n), [1, 2]);
    // #1 锚在 Bubble 组件根：摘录两段（帧实例 + 组件定义），组件与共用帧数就位。
    const bubble = homeRows[0];
    assert.equal(bubble.comp, 'Bubble');
    assert.ok(bubble.sharedFrames >= 1);
    assert.ok(bubble.excerpt.some((line) => line.includes('home.jsx（帧内实例）')), JSON.stringify(bubble.excerpt));
    assert.ok(bubble.excerpt.some((line) => line.includes('kit') || line.includes('Bubble')), '组件定义段在');
    // #2 锚在普通元素：单段，行号指 home.jsx:9。
    const plain = homeRows[1];
    assert.equal(plain.comp, null);
    assert.equal(plain.intent, 'changeTo');
    assert.ok(plain.excerpt.some((line) => line.includes('home.jsx')));
  });

  test('--status all 计入 check；--frame A2 只剩存量帧', () => {
    const site = makeSite();
    const context = contextFor(site);
    const all = buildCheckReport(context, { status: 'all' });
    assert.equal(all.groups.flatMap((group) => group.rows).length, 4);
    const oldOnly = buildCheckReport(context, { frame: 'A2' });
    assert.deepEqual(oldOnly.groups.map((group) => group.screenId), ['old']);
    const missing = buildCheckReport(context, { frame: 'Z9' });
    assert.match(missing.error, /没有帧 Z9/);
  });

  test('--group-by component：无组件归「仅本帧」；存量帧 outerHTML 摘录行号指 dist', () => {
    const site = makeSite();
    const context = contextFor(site);
    const report = buildCheckReport(context, { status: 'all', groupBy: 'component' });
    const titles = report.groups.map((group) => group.title).sort();
    assert.ok(titles.includes('Bubble'));
    assert.ok(titles.includes('仅本帧'));
    const legacy = report.groups.flatMap((group) => group.rows).find((row) => row.n === 4);
    assert.equal(legacy.comp, null);
    assert.ok(legacy.excerpt.some((line) => line.includes('dist/demo-page/old.html')), JSON.stringify(legacy.excerpt));
    assert.ok(legacy.excerpt.some((line) => line.includes('>')), '行号体在');
  });

  test('锚点失效与无 dist 的帧：摘录降级为提示，不抛', () => {
    const site = makeSite();
    const context = contextFor(site);
    context.frameRows.push({
      id: 'b5', n: 5, pageId: 'demo-page', screenId: 'home', status: 'open', content: '幽灵',
      targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > span.gone:nth-of-type(1)' }],
    });
    context.frameRows.push({
      id: 'b6', n: 6, pageId: 'demo-page', screenId: 'unbuilt', status: 'open', content: '没编的帧',
      targets: [{ ref: 'i1', selector: 'div.ios-stage:nth-of-type(1) > div.x:nth-of-type(1)' }],
    });
    const report = buildCheckReport(context, { status: 'all' });
    const gone = report.groups.flatMap((group) => group.rows).find((row) => row.n === 5);
    assert.ok(gone.excerpt[0].includes('解析不到'), gone.excerpt[0]);
    const unbuilt = report.groups.flatMap((group) => group.rows).find((row) => row.n === 6);
    assert.ok(unbuilt.excerpt[0].includes('无 dist'), unbuilt.excerpt[0]);
  });
});

describe('formatCheckMarkdown / countByStatus / intentOf', () => {
  test('markdown：状态与 note 与摘录缩进', () => {
    const site = makeSite();
    const report = buildCheckReport(contextFor(site), { status: 'all' });
    const lines = formatCheckMarkdown(report);
    assert.ok(lines[0].startsWith('# demo-page'));
    assert.ok(lines.some((line) => line.includes('[#3]') && line.includes('check') && line.includes('看过，不改')));
    assert.ok(lines.some((line) => line.trimStart().startsWith('↖')), '兄弟提示在');
  });

  test('countByStatus 与 intentOf', () => {
    assert.deepEqual(countByStatus([{ status: 'open' }, {}, { status: 'done' }]), { open: 2, check: 0, done: 1, close: 0, total: 3 });
    assert.equal(intentOf({}), '普通');
    assert.equal(intentOf({ move: { to: 1 } }), 'move');
    assert.equal(intentOf({ changeTo: 'x', move: {} }), 'changeTo+move');
  });
});

describe('locateLine', () => {
  test('编译页给源文件:行 + 组件；存量页给 dist 路径 + selector', () => {
    const site = makeSite();
    const context = contextFor(site);
    const bubble = locateLine(context.frameRows[0], context);
    assert.match(bubble.text, /#1 → content\/kits\/ios\/jsx\/Bubble\.jsx:17 · 组件 Bubble（共用 1 帧）/);
    const legacy = locateLine(context.frameRows[3], context);
    assert.match(legacy.text, /#4 → dist\/demo-page\/old\.html · /);
  });
});
