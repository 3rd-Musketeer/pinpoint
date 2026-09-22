import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  boardScreenIds,
  compilePage,
  distStatus,
  injectAssets,
  lintStampSource,
  listPageIds,
  readDistScreen,
  renderScreenHtml,
  resolvePageTarget,
} from './page-compiler.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-compiler-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makePage(name, { board, files = {} }) {
  const pageDir = path.join(tmp, name);
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify(board, null, 2));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(pageDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return { entryId: name, pageDir, urlBase: `/sites/${name}/`, kind: 'dir' };
}

function distFile(target, name) {
  return path.join(tmp, 'dist', target.entryId, name);
}

const BASIC_BOARD = {
  sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
};

describe('jsx 帧编译', () => {
  test('渲染产物落 dist，宿主元素带 data-pp-id（文件:行#n）', async () => {
    const target = makePage('jsx-basic', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': [
          'export default function Home() {',   // line 1
          '  return (',                          // line 2
          '    <div className="ios-app">',       // line 3
          '      <p>你好</p>',                   // line 4
          '    </div>',                          // line 5
          '  );',                                // line 6
          '}',                                   // line 7
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true);
    assert.equal(result.screens.length, 1);
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.match(html, /<div class="ios-app" data-pp-id="home\.jsx:3#1" data-pp-comp="Home">/);
    assert.match(html, /<p data-pp-id="home\.jsx:4#1">你好<\/p>/);
    assert.ok(!html.includes('<!doctype'), '输出是 HTML 片段，不带 doctype');
  });

  test('同一 文件:行 的多个实例从 1 起计数；组件根宿主元素带 data-pp-comp', async () => {
    const target = makePage('jsx-count', {
      board: BASIC_BOARD,
      files: {
        'components/Badge.jsx': [
          'export function Badge({ label }) {',  // line 1
          '  return <span className="badge">{label}</span>', // line 2
          '}',                                   // line 3
          '',
        ].join('\n'),
        'home.jsx': [
          'import { Badge } from \'./components/Badge.jsx\';',
          '',
          'export default function Home() {',
          '  return (',
          '    <div className="ios-app">',
          '      {[1, 2, 3].map((n) => <span key={n}>{n}</span>)}',
          '      <Badge label="新" />',
          '    </div>',
          '  );',
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.ok(html.includes('data-pp-id="home.jsx:6#1"'), html);
    assert.ok(html.includes('data-pp-id="home.jsx:6#2"'), html);
    assert.ok(html.includes('data-pp-id="home.jsx:6#3"'), html);
    assert.match(html, /<span class="badge" data-pp-id="components\/Badge\.jsx:2#1" data-pp-comp="Badge">新<\/span>/);
  });

  test('#n 按文档顺序编号：同一行嵌套父元素在前，map 同行实例顺序排', async () => {
    const target = makePage('jsx-doc-order', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': [
          'export default function Home() {',
          '  return <div className="ios-app"><p>同</p></div>;',  // line 2：div 与 p 同行
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    // 创建顺序是 p 先 div 后，文档顺序必须 div #1、p #2。
    assert.match(html, /^<div class="ios-app" data-pp-id="home\.jsx:2#1"[^>]*><p data-pp-id="home\.jsx:2#2">同<\/p><\/div>$/);
  });

  test('同一屏连编 3 次结果一致（cjs 求值无模块缓存残留）', async () => {
    const target = makePage('jsx-repeat', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><p>稳</p></div>;\n}\n',
      },
    });
    const distRoot = path.join(tmp, 'dist');
    const outputs = [];
    for (let i = 0; i < 3; i += 1) {
      const result = await compilePage(target, { distRoot });
      assert.equal(result.ok, true, JSON.stringify(result.screens));
      outputs.push(fs.readFileSync(distFile(target, 'home.html'), 'utf8'));
    }
    assert.equal(outputs[0], outputs[1]);
    assert.equal(outputs[1], outputs[2]);
  });

  test('data-pp-comp 只打用户命名的组件：匿名默认导出不打，命名导出照打', async () => {
    const target = makePage('jsx-comp-name', {
      board: {
        sections: [{
          id: 'main', title: 'Main', layout: 'row',
          screens: [{ id: 'anon', title: 'Anon' }, { id: 'named', title: 'Named' }],
        }],
      },
      files: {
        'components/Badge.jsx': 'export const Badge = () => <span className="badge">章</span>;\n',
        'anon.jsx': 'export default () => <div className="ios-app"><p>匿名</p></div>;\n',
        'named.jsx': [
          'import { Badge } from \'./components/Badge.jsx\';',
          'export default function Named() {',
          '  return <div className="ios-app"><Badge /></div>;',
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const anon = fs.readFileSync(distFile(target, 'anon.html'), 'utf8');
    assert.ok(!anon.includes('data-pp-comp'), anon);
    const named = fs.readFileSync(distFile(target, 'named.html'), 'utf8');
    assert.match(named, /<div class="ios-app" data-pp-id="named\.jsx:3#1" data-pp-comp="Named">/);
    assert.match(named, /<span class="badge" data-pp-id="components\/Badge\.jsx:1#1" data-pp-comp="Badge">章<\/span>/);
  });

  test('pinpoint/kit 解析到 kit JSX 组件（切片 2）', async () => {
    const target = makePage('jsx-kit', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': [
          'import { Bubble } from \'pinpoint/kit\';',
          'export default function Home() {',
          '  return <div className="ios-app"><Bubble side="incoming">早</Bubble></div>;',
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.ok(html.includes('ios-bubble ios-bubble-in'), html);
    assert.match(html, /data-pp-comp="Bubble"/);
  });

  test('goto 属性编译成 data-goto（flow 边数据层，lint 不拦）', async () => {
    const target = makePage('jsx-goto', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': [
          'export default function Home() {',
          '  return <div className="ios-app"><button goto="detail">去看</button></div>;',
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.ok(html.includes('data-goto="detail"'), html);
    assert.ok(!/\bgoto=/.test(html.replace('data-goto=', '')), html);
  });

  test('相对 import 解析失败 = 编译错误，报文件与行', async () => {
    const target = makePage('jsx-missing-import', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': 'import { X } from \'./nope.jsx\';\nexport default function Home() {\n  return <div className="ios-app"><X /></div>;\n}\n',
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, false);
    assert.match(result.screens[0].error, /home\.jsx:1/);
    assert.equal(fs.existsSync(distFile(target, 'home.html')), false);
  });
});

describe('comp 屏（variants 墙）', () => {
  const COMP_BOARD = (screens) => ({
    sections: [{ id: 'wall', title: 'Wall', layout: 'row', shell: 'comp', screens }],
  });

  test('页内组件：命名导出与默认导出都能渲染，props 到位', async () => {
    const target = makePage('comp-page', {
      board: COMP_BOARD([
        { id: 'pill', title: 'pill', comp: 'Composer', props: { state: 'pill' } },
        { id: 'bar', title: 'bar', comp: 'Plain' },
      ]),
      files: {
        'components/Composer.jsx': [
          'export function Composer({ state }) {',
          '  return <div className="composer">状态:{state}</div>;',
          '}',
          '',
        ].join('\n'),
        'components/Plain.jsx': 'export default function Plain() {\n  return <div className="plain">默认导出</div>;\n}\n',
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const pill = fs.readFileSync(distFile(target, 'pill.html'), 'utf8');
    assert.match(pill, /<div class="composer" data-pp-id="components\/Composer\.jsx:2#1" data-pp-comp="Composer">状态:pill<\/div>/);
    const bar = fs.readFileSync(distFile(target, 'bar.html'), 'utf8');
    assert.match(bar, /data-pp-comp="Plain"/);
    const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.equal(build.sources.pill.file, 'components/Composer.jsx');
  });

  test('页内没有就回退 pinpoint/kit', async () => {
    const target = makePage('comp-kit', {
      board: COMP_BOARD([{ id: 'b-in', title: 'incoming', comp: 'Bubble', props: { side: 'incoming' } }]),
      files: {},
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'b-in.html'), 'utf8');
    assert.ok(html.includes('ios-bubble ios-bubble-in'), html);
    assert.match(html, /data-pp-comp="Bubble"/);
    const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.match(build.sources['b-in'].file, /content\/kits\/ios\/jsx\/Bubble\.jsx$/);
  });

  test('找不到组件的屏报错，其他屏照常', async () => {
    const target = makePage('comp-missing', {
      board: COMP_BOARD([
        { id: 'nope', title: 'nope', comp: 'Ghost' },
        { id: 'ok', title: 'ok', comp: 'Bubble' },
      ]),
      files: {},
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, false);
    assert.match(result.screens.find((s) => s.id === 'nope').error, /找不到组件 Ghost/);
    assert.equal(result.screens.find((s) => s.id === 'ok').ok, true);
    const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.match(build.errors.nope, /找不到组件/);
  });

  test('组件文件存在但没有可用导出 → 明确错误', async () => {
    const target = makePage('comp-noexport', {
      board: COMP_BOARD([{ id: 'x', title: 'x', comp: 'Empty' }]),
      files: { 'components/Empty.jsx': 'export const notAComponent = 1;\n' },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, false);
    assert.match(result.screens[0].error, /没有命名导出或默认导出/);
  });
});

describe('.html 帧', () => {
  test('.html 帧逐字节恒等', async () => {
    const fragment = '<div class="ios-app">\n  <div class="ios-page">恒等</div>\n</div>\n';
    const target = makePage('html-identity', { board: BASIC_BOARD, files: { 'home.html': fragment } });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(distFile(target, 'home.html'), 'utf8'), fragment);
  });
});

describe('assets 注入', () => {
  const ASSETS_BOARD = {
    assets: { css: ['pk.css', 'extra.css'], js: ['pk.js'] },
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }] }],
  };

  test('css 注入帧开头、js 注入帧末尾（.html 与 .jsx 帧都生效）', async () => {
    const target = makePage('assets-page', {
      board: ASSETS_BOARD,
      files: { 'home.html': '<div class="ios-app">x</div>\n' },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true);
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.ok(html.startsWith('<style>@import url("/sites/assets-page/pk.css");</style>\n<style>@import url("/sites/assets-page/extra.css");</style>\n<div'), html);
    assert.ok(html.endsWith('<script type="module" data-preview-script src="/sites/assets-page/pk.js"></script>'), html);
  });

  test('存量帧手写了同 URL 的行不重复注入', async () => {
    const handwritten = '<style>@import url("/sites/assets-dedupe/pk.css");</style>\n<div class="ios-app">x</div>\n<script type="module" data-preview-script src="/sites/assets-dedupe/pk.js"></script>\n';
    const target = makePage('assets-dedupe', { board: ASSETS_BOARD, files: { 'home.html': handwritten } });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true);
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.equal(html.match(/pk\.css/g).length, 1, html);
    assert.equal(html.match(/pk\.js/g).length, 1, html);
    assert.ok(html.includes('extra.css'), '没手写的 css 仍然注入');
  });

  test('injectAssets 纯函数：非数组 / 非字符串项宽容忽略', () => {
    assert.equal(injectAssets('<div/>', null, '/sites/x/'), '<div/>');
    assert.equal(injectAssets('<div/>', { css: [1, ''] }, '/sites/x/'), '<div/>');
  });
});

describe('lint', () => {
  async function lintError(files) {
    const target = makePage('lint-page', { board: BASIC_BOARD, files });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, false);
    return result.screens[0].error;
  }

  test('import preact/hooks 报错并带行号', async () => {
    const error = await lintError({ 'home.jsx': 'import { useState } from \'preact/hooks\';\nexport default function Home() {\n  return <div className="ios-app">x</div>;\n}\n' });
    assert.match(error, /home\.jsx:1.*preact\/hooks/);
  });

  test('onX 事件属性报错并带行号', async () => {
    const error = await lintError({ 'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><button onClick={() => 1}>x</button></div>;\n}\n' });
    assert.match(error, /home\.jsx:2.*onClick/);
  });

  test('fetch( 报错并带行号', async () => {
    const error = await lintError({ 'home.jsx': 'export default function Home() {\n  const load = () => fetch(\'/api\');\n  return <div className="ios-app">{load}</div>;\n}\n' });
    assert.match(error, /home\.jsx:2.*fetch/);
  });

  test('顶层 import / export default 之外的语句报错', async () => {
    const error = await lintError({ 'home.jsx': 'export default function Home() {\n  return <div className="ios-app">x</div>;\n}\n\nconst stolen = 1;\n' });
    assert.match(error, /home\.jsx:5.*顶层/);
  });

  test('帧文件顶层放行函数声明（帧内小组件），const 仍拦', async () => {
    const target = makePage('lint-fn-decl', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': [
          'function Card({ label }) {',
          '  return <div className="ios-card">{label}</div>;',
          '}',
          '',
          'export default function Home() {',
          '  return <div className="ios-app"><Card label="内" /></div>;',
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.ok(html.includes('内'));
    assert.match(html, /data-pp-comp="Card"/);
  });

  test('顶层语句判定不咬函数体与多行 import', () => {
    const ok = [
      'import {',
      '  Badge,',
      '} from \'./components/Badge.jsx\';',
      '',
      'export default function Home() {',
      '  const items = [1, 2].map((n) => n * 2);',
      '  return (',
      '    <div className="ios-app">{items}</div>',
      '  );',
      '}',
      '',
    ].join('\n');
    assert.deepEqual(lintStampSource(ok, 'home.jsx'), []);
  });
});

describe('缺源码与 build.json', () => {
  test('缺源码的屏报错，其他屏照常编译', async () => {
    const board = {
      sections: [{
        id: 'main', title: 'Main', layout: 'row',
        screens: [{ id: 'home', title: 'Home' }, { id: 'ghost', title: 'Ghost' }],
      }],
    };
    const target = makePage('missing-src', { board, files: { 'home.html': '<div class="ios-app">在</div>\n' } });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, false);
    assert.equal(result.screens.find((s) => s.id === 'home').ok, true);
    const ghost = result.screens.find((s) => s.id === 'ghost');
    assert.equal(ghost.ok, false);
    assert.match(ghost.error, /源码不存在/);
    assert.equal(fs.existsSync(distFile(target, 'home.html')), true);
    assert.equal(fs.existsSync(distFile(target, 'ghost.html')), false);

    const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.equal(typeof build.builtAt, 'number');
    assert.equal(build.sources.home.file, 'home.html');
    assert.equal(typeof build.sources.home.mtimeMs, 'number');
    assert.equal(build.sources.ghost, undefined);
    assert.match(build.errors.ghost, /源码不存在/);

    const read = readDistScreen(target.entryId, 'ghost', { distRoot: path.join(tmp, 'dist') });
    assert.equal(read.kind, 'error');
    assert.match(read.message, /源码不存在/);
    assert.equal(readDistScreen(target.entryId, 'home', { distRoot: path.join(tmp, 'dist') }).kind, 'ok');
    assert.equal(readDistScreen('never-built', 'x', { distRoot: path.join(tmp, 'dist') }).kind, 'unbuilt');
  });

  test('--screen 单屏编译合并既有 build.json', async () => {
    const board = {
      sections: [{
        id: 'main', title: 'Main', layout: 'row',
        screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      }],
    };
    const target = makePage('partial', { board, files: { 'a.html': '<div class="ios-app">a</div>\n', 'b.html': '<div class="ios-app">b</div>\n' } });
    const distRoot = path.join(tmp, 'dist');
    await compilePage(target, { distRoot });
    fs.writeFileSync(path.join(target.pageDir, 'a.jsx'), 'const nope = 1;\nexport default function A() {\n  return <div className="ios-app">a2</div>;\n}\n');
    const second = await compilePage(target, { distRoot, onlyScreen: 'a' });
    assert.equal(second.ok, false);
    const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.match(build.errors.a, /顶层/);
    assert.equal(build.errors.b, undefined);
    assert.equal(build.sources.b.file, 'b.html');
    assert.equal(fs.readFileSync(distFile(target, 'b.html'), 'utf8'), '<div class="ios-app">b</div>\n');
  });
});

describe('dist 状态与 serve 读取', () => {
  test('distStatus：编完不过期，源文件 mtime 晚于 builtAt 则过期', async () => {
    const target = makePage('stale-page', { board: BASIC_BOARD, files: { 'home.html': '<div class="ios-app">x</div>\n' } });
    const distRoot = path.join(tmp, 'dist');
    assert.deepEqual(distStatus(target.entryId, target.pageDir, { distRoot }), { builtAt: null, stale: true });
    await compilePage(target, { distRoot });
    const fresh = distStatus(target.entryId, target.pageDir, { distRoot });
    assert.equal(fresh.stale, false);
    assert.equal(typeof fresh.builtAt, 'number');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(target.pageDir, 'home.html'), future, future);
    assert.equal(distStatus(target.entryId, target.pageDir, { distRoot }).stale, true);
  });

  test('renderScreenHtml 编译单屏但不落 dist', async () => {
    const target = makePage('render-page', {
      board: BASIC_BOARD,
      files: { 'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><p>看</p></div>;\n}\n' },
    });
    const distRoot = path.join(tmp, 'dist');
    const result = await renderScreenHtml(target, 'home');
    assert.equal(result.ok, true);
    assert.ok(result.html.includes('看'));
    assert.ok(result.html.includes('data-pp-id="home.jsx:2#1"'));
    assert.equal(fs.existsSync(distRoot), false);
    const missing = await renderScreenHtml(target, 'ghost');
    assert.equal(missing.ok, false);
    assert.match(missing.error, /源码不存在/);
  });
});

describe('页解析', () => {
  test('registry dir 条目优先，其次模板页；找不到返回 null', () => {
    const root = path.join(tmp, 'repo');
    const pageDir = path.join(tmp, 'outside', 'ext-page');
    fs.mkdirSync(pageDir, { recursive: true });
    fs.writeFileSync(path.join(pageDir, 'board.json'), '{}');
    fs.mkdirSync(path.join(root, 'content', 'previews', 'tpl'), { recursive: true });
    fs.writeFileSync(path.join(root, 'content', 'previews', 'tpl', 'board.json'), '{}');
    fs.writeFileSync(path.join(root, 'content', 'previews', '_index.json'), JSON.stringify({ defaultPage: 'tpl', pages: [{ id: 'tpl', title: 'Tpl', mode: 'ios' }] }));
    const registry = {
      entries: [{ id: 'ext-page', kind: 'dir', path: pageDir }],
      resolve(id) { return this.entries.find((e) => e.id === id) || null; },
    };
    assert.deepEqual(resolvePageTarget('ext-page', { registry, root }), {
      entryId: 'ext-page', pageDir, urlBase: '/sites/ext-page/', kind: 'dir',
    });
    assert.deepEqual(resolvePageTarget('tpl', { registry, root }), {
      entryId: 'tpl', pageDir: path.join(root, 'content', 'previews', 'tpl'), urlBase: '/previews/tpl/', kind: 'template',
    });
    assert.equal(resolvePageTarget('ghost', { registry, root }), null);
    assert.equal(resolvePageTarget('../etc', { registry, root }), null);
    assert.deepEqual(listPageIds({ registry, root }), ['ext-page', 'tpl']);
    assert.deepEqual(boardScreenIds(pageDir), null);
  });
});
