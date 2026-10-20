import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  boardScreenIds,
  buildAllPages,
  compilePage,
  compilerStamp,
  distIsFresh,
  distStatus,
  injectAssets,
  lintStampSource,
  listPageIds,
  readDistScreen,
  renderScreenHtml,
} from './page-compiler.js';
import { resolvePageTarget } from './board-source.js';

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
  test('渲染产物落 dist，宿主元素带 data-pp-id（文件:行@n）', async () => {
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
    assert.match(html, /<div class="ios-app" data-pp-id="home\.jsx:3@1" data-pp-comp="Home">/);
    assert.match(html, /<p data-pp-id="home\.jsx:4@1">你好<\/p>/);
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
    assert.ok(html.includes('data-pp-id="home.jsx:6@1"'), html);
    assert.ok(html.includes('data-pp-id="home.jsx:6@2"'), html);
    assert.ok(html.includes('data-pp-id="home.jsx:6@3"'), html);
    assert.match(html, /<span class="badge" data-pp-id="components\/Badge\.jsx:2@1" data-pp-comp="Badge">新<\/span>/);
  });

  test('@n 按文档顺序编号：同一行嵌套父元素在前，map 同行实例顺序排', async () => {
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
    // 创建顺序是 p 先 div 后，文档顺序必须 div @1、p @2。
    assert.match(html, /^<div class="ios-app" data-pp-id="home\.jsx:2@1"[^>]*><p data-pp-id="home\.jsx:2@2">同<\/p><\/div>$/);
  });

  test('board 里还有 variants 的 screen 条目：整页不编，报迁移提示（ADR 0040）', async () => {
    const target = makePage('retired-variants', {
      board: { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'confirm', variants: [{ id: 'a' }, { id: 'b' }] }] }] },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, false);
    assert.match(result.error, /screen confirm：变体组已退役（ADR 0040）；把变体摊平成同一个 section 里的普通 frame/);
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
    assert.match(named, /<div class="ios-app" data-pp-id="named\.jsx:3@1" data-pp-comp="Named">/);
    assert.match(named, /<span class="badge" data-pp-id="components\/Badge\.jsx:1@1" data-pp-comp="Badge">章<\/span>/);
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
    assert.match(pill, /<div class="composer" data-pp-id="components\/Composer\.jsx:2@1" data-pp-comp="Composer">状态:pill<\/div>/);
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

  test('injectAssets 纯函数：非数组 / 非字符串项宽容忽略；assets 自身重复先去重（R10）', () => {
    assert.equal(injectAssets('<div/>', null, '/sites/x/'), '<div/>');
    assert.equal(injectAssets('<div/>', { css: [1, ''] }, '/sites/x/'), '<div/>');
    const html = injectAssets('<div/>', { css: ['pk.css', 'pk.css'], js: ['pk.js', 'pk.js', 'pk.js'] }, '/sites/x/');
    assert.equal(html.match(/pk\.css/g).length, 1, html);
    assert.equal(html.match(/pk\.js/g).length, 1, html);
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

  test('帧文件顶层放行 export const shell（文章画布的帧级 shell），别的命名导出照拦', () => {
    const frame = (decl) => [decl, '', 'export default function F() {', '  return <div />;', '}', ''].join('\n');
    assert.deepEqual(lintStampSource(frame('export const shell = "comp";'), 'f.jsx', { entry: true }), []);
    const bad = lintStampSource(frame('export const mode = "comp";'), 'f.jsx', { entry: true });
    assert.equal(bad.length, 1);
    assert.match(bad[0].message, /^f\.jsx:1: 顶层只允许 import、export default、export const shell 和函数声明/);
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

  test('--frame 单屏编译合并既有 build.json', async () => {
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

  test('onlyScreens 多屏增量：只重编点名的屏，其余产物与记录不动（审计 B1）', async () => {
    const board = {
      sections: [{
        id: 'main', title: 'Main', layout: 'row',
        screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }],
      }],
    };
    const target = makePage('partial-multi', {
      board,
      files: {
        'a.jsx': 'export default function A() {\n  return <div className="ios-app">a1</div>;\n}\n',
        'b.html': '<div class="ios-app">b1</div>\n',
        'c.html': '<div class="ios-app">c1</div>\n',
      },
    });
    const distRoot = path.join(tmp, 'dist');
    await compilePage(target, { distRoot });
    const cBefore = fs.statSync(distFile(target, 'c.html')).mtimeMs;
    // 改 a、b：失败屏的旧产物要删、错误只落点名屏；c 原样。
    fs.writeFileSync(path.join(target.pageDir, 'a.jsx'), 'export default function A() {\n  return <div className="ios-app"><p onClick={() => 1}>a2 坏</p></div>;\n}\n');
    fs.writeFileSync(path.join(target.pageDir, 'b.html'), '<div class="ios-app">b2</div>\n');
    const second = await compilePage(target, { distRoot, onlyScreens: ['a', 'b'] });
    assert.equal(second.ok, false);
    assert.deepEqual(second.screens.map((row) => row.id), ['a', 'b'], '结果里只有点名的屏');
    const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.match(build.errors.a, /onClick/);
    assert.equal(build.errors.b, undefined);
    assert.equal(fs.existsSync(distFile(target, 'a.html')), false, '失败屏旧产物删除');
    assert.equal(fs.readFileSync(distFile(target, 'b.html'), 'utf8'), '<div class="ios-app">b2</div>\n');
    assert.equal(fs.statSync(distFile(target, 'c.html')).mtimeMs, cBefore, '没点名的屏产物不重写');
    assert.equal(build.sources.c.file, 'c.html');
    // 修好 a 再增量一轮：错误清掉，产物回来。
    fs.writeFileSync(path.join(target.pageDir, 'a.jsx'), 'export default function A() {\n  return <div className="ios-app">a3</div>;\n}\n');
    const third = await compilePage(target, { distRoot, onlyScreens: ['a'] });
    assert.equal(third.ok, true);
    const final = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.equal(final.errors.a, undefined);
    assert.equal(fs.readFileSync(distFile(target, 'a.html'), 'utf8').includes('a3</div>'), true);
  });

  test('onlyScreens 为空数组按全编处理：不许一屏不编只刷 builtAt（review 建议 2）', async () => {
    const board = { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }] };
    const target = makePage('partial-empty', {
      board,
      files: { 'a.html': '<div class="ios-app">a1</div>\n', 'b.html': '<div class="ios-app">b1</div>\n' },
    });
    const distRoot = path.join(tmp, 'dist');
    await compilePage(target, { distRoot });
    fs.writeFileSync(path.join(target.pageDir, 'a.html'), '<div class="ios-app">a2</div>\n');
    const result = await compilePage(target, { distRoot, onlyScreens: [] });
    assert.deepEqual(result.screens.map((row) => row.id), ['a', 'b']);
    assert.equal(result.partial, false);
    assert.equal(fs.readFileSync(distFile(target, 'a.html'), 'utf8'), '<div class="ios-app">a2</div>\n');
    assert.equal(distStatus('partial-empty', target.pageDir, { distRoot }).stale, false);
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

  test('编成功后改出 lint 错：旧产物删除、serve 报 error、stale 不被失败重编刷绿（R1）', async () => {
    const target = makePage('fail-rebuild', {
      board: BASIC_BOARD,
      files: { 'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><p>好</p></div>;\n}\n' },
    });
    const distRoot = path.join(tmp, 'dist');
    const first = await compilePage(target, { distRoot });
    assert.equal(first.ok, true);
    assert.equal(readDistScreen(target.entryId, 'home', { distRoot }).kind, 'ok');
    // BACKLOG 偶挂（高负载首跑）：builtAt 是 performance 历元、mtime 是实时钟，两钟岔开时
    // fresh 会误判成 stale；带上差值，下次挂直接看到证据。
    const fresh = distStatus(target.entryId, target.pageDir, { distRoot });
    const homeMtime = fs.statSync(path.join(target.pageDir, 'home.jsx')).mtimeMs;
    assert.equal(fresh.stale, false, `builtAt=${fresh.builtAt} home.jsx mtime=${homeMtime} diff=${(homeMtime - fresh.builtAt).toFixed(3)}ms`);
    // 改出 lint 错（onClick）→ 失败重编：旧 home.html 必须删，不能拿改坏前的画面顶班。
    fs.writeFileSync(path.join(target.pageDir, 'home.jsx'), 'export default function Home() {\n  return <div className="ios-app"><button onClick={() => 1}>坏</button></div>;\n}\n');
    const second = await compilePage(target, { distRoot });
    assert.equal(second.ok, false);
    assert.equal(fs.existsSync(distFile(target, 'home.html')), false, '失败屏的旧产物必须删除');
    const read = readDistScreen(target.entryId, 'home', { distRoot });
    assert.equal(read.kind, 'error');
    assert.match(read.message, /onClick/);
    assert.equal(distStatus(target.entryId, target.pageDir, { distRoot }).stale, true, '失败重编不得把 stale 刷成 false');
    // 「源码不存在」的屏没有源码记录，不算 stale —— e2e 的 jsx-site 固件页
    // 常年挂一屏缺源码（500 + 错误面板如实表达），dist 并没有落后于什么。
    const ghostTarget = makePage('fail-ghost', {
      board: { sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: 'Home' }, { id: 'ghost', title: 'Ghost' }] }] },
      files: { 'home.html': '<div class="ios-app">在</div>\n' },
    });
    await compilePage(ghostTarget, { distRoot });
    assert.equal(distStatus(ghostTarget.entryId, ghostTarget.pageDir, { distRoot }).stale, false, '缺源码屏不算 stale');
  });

  test('comp 名不合法的屏进 errors，页外文件不进 dist（建议 4）', async () => {
    // board.json 手写绕得过 workbench 的 preview-contracts，编译侧用同一条
    // COMP_NAME_PATTERN 再拦一道：`../../x` 这类名不进路径拼接。
    const target = makePage('bad-comp', {
      board: { sections: [{ id: 'main', title: 'Main', layout: 'row', shell: 'comp', screens: [
        { id: 'evil', title: 'evil', comp: '../../x' },
        { id: 'bub', title: 'bub', comp: 'Bubble', props: { side: 'incoming' } },
      ] }] },
      files: {},
    });
    // 页外文件真的放在指到的位置：没有校验的话它会被编进 dist。
    fs.writeFileSync(path.join(tmp, 'x.jsx'), 'export function x() {\n  return null;\n}\n');
    const distRoot = path.join(tmp, 'dist');
    const result = await compilePage(target, { distRoot });
    assert.equal(result.ok, false);
    const evil = result.screens.find((row) => row.id === 'evil');
    assert.match(evil.error, /comp 名不合法/);
    assert.equal(result.screens.find((row) => row.id === 'bub').ok, true, '其余屏照常编译');
    assert.equal(fs.existsSync(path.join(distRoot, 'bad-comp', 'evil.html')), false);
  });

  test('帧的组件依赖进 sources：kit / 页内组件改动后 stale 如实上报（R2）', async () => {
    // kit 印章是仓库里的共享文件，这里只读它的 mtime、不改：改了会和同时在跑的别的测试进程、
    // 这个工作区里 dev 服务的 watch 互相踩（几条并发跑时约 1/5 挂在「恢复后不再过期」）。
    // 「kit 比产物新」反过来造：把这一页的 builtAt 和页内文件一起挪到 kit 的 mtime 之前。
    const kitFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'content', 'kits', 'ios', 'jsx', 'Bubble.jsx');
    const kitMtime = fs.statSync(kitFile).mtimeMs;
    const backdateBefore = (target, ms) => {
      const old = new Date(ms - 60_000);
      for (const rel of ['board.json', ...fs.readdirSync(target.pageDir, { recursive: true })]) {
        fs.utimesSync(path.join(target.pageDir, rel), old, old);
      }
      const buildFile = distFile(target, 'build.json');
      const build = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
      fs.writeFileSync(buildFile, JSON.stringify({ ...build, builtAt: ms - 1 }));
    };
    const compTarget = makePage('deps-comp', {
      board: { sections: [{ id: 'main', title: 'Main', layout: 'row', shell: 'comp', screens: [
        { id: 'pill', title: 'pill', comp: 'Composer' },
        { id: 'bub', title: 'bub', comp: 'Bubble', props: { side: 'incoming' } },
      ] }] },
      files: { 'components/Composer.jsx': 'export function Composer() {\n  return <div className="composer">x</div>;\n}\n' },
    });
    const frameTarget = makePage('deps-frame', {
      board: BASIC_BOARD,
      files: {
        'components/Badge.jsx': 'export function Badge() {\n  return <span className="badge">章</span>;\n}\n',
        'home.jsx': 'import { Badge } from \'./components/Badge.jsx\';\nexport default function Home() {\n  return <div className="ios-app"><Badge /></div>;\n}\n',
      },
    });
    const kitFrameTarget = makePage('deps-kit-frame', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': 'import { Bubble } from \'pinpoint/kit\';\nexport default function Home() {\n  return <div className="ios-app"><Bubble side="incoming">嗨</Bubble></div>;\n}\n',
      },
    });
    const distRoot = path.join(tmp, 'dist');
    const stale = (target) => distStatus(target.entryId, target.pageDir, { distRoot }).stale;
    for (const target of [compTarget, frameTarget, kitFrameTarget]) {
      assert.equal((await compilePage(target, { distRoot })).ok, true);
      assert.equal(stale(target), false, `${target.entryId} 编完不过期`);
    }
    const future = new Date(Date.now() + 5000);
    const past = new Date(Date.now() - 60_000);
    // 页内组件改动 → comp 屏与 import 它的帧都过期；改回比 builtAt 旧就不再过期。
    const composer = path.join(compTarget.pageDir, 'components', 'Composer.jsx');
    fs.utimesSync(composer, future, future);
    assert.equal(stale(compTarget), true);
    fs.utimesSync(composer, past, past);
    assert.equal(stale(compTarget), false, '恢复后不再过期');
    const badge = path.join(frameTarget.pageDir, 'components', 'Badge.jsx');
    fs.utimesSync(badge, future, future);
    assert.equal(stale(frameTarget), true);
    // kit 印章比产物新 → 用它的 comp 屏、import kit 的帧都过期（deps 记 ../ 链，distStatus 照样解析）。
    for (const target of [compTarget, kitFrameTarget]) {
      backdateBefore(target, kitMtime);
      assert.equal(stale(target), true, `${target.entryId}：kit 晚于 builtAt`);
      backdateBefore(target, Date.now());
      assert.equal(stale(target), false, `${target.entryId}：builtAt 晚于 kit`);
    }
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
    assert.ok(result.html.includes('data-pp-id="home.jsx:2@1"'));
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

describe('页 tab（ADR 0041）', () => {
  const frame = (id) => `export default function F() { return <div className="ios-app"><p>${id}</p></div>; }\n`;
  const sec = (id, ids) => ({ id, title: id, layout: 'row', screens: ids });

  test('所有 tab 的屏一起编，与活动 tab 无关；boardScreenIds 认全部 tab 的屏', async () => {
    const target = makePage('tabbed', {
      board: { tabs: [
        { id: 'comps', sections: [sec('btn', ['btn-a', 'btn-b'])] },
        { id: 'flow', sections: [sec('onboard', ['ob-1'])] },
      ] },
      files: { 'btn-a.jsx': frame('a'), 'btn-b.jsx': frame('b'), 'ob-1.jsx': frame('o') },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.screens.map((row) => row.id), ['btn-a', 'btn-b', 'ob-1']);
    assert.ok(fs.existsSync(distFile(target, 'ob-1.html')));
    assert.deepEqual([...boardScreenIds(target.pageDir)].sort(), ['btn-a', 'btn-b', 'ob-1']);
    assert.equal((await renderScreenHtml(target, 'ob-1')).ok, true);
  });

  test('tabs 与 sections 并存 / 空 tab / 跨 tab 重复屏 id：整页编译失败并给出原因', async () => {
    const both = makePage('both', {
      board: { sections: [sec('a', ['x'])], tabs: [{ id: 't', sections: [sec('b', ['y'])] }] },
    });
    const r1 = await compilePage(both, { distRoot: path.join(tmp, 'dist') });
    assert.equal(r1.ok, false);
    assert.match(r1.error, /sections 与 tabs 二选一/);
    const empty = makePage('empty', { board: { tabs: [{ id: 't', sections: [] }] } });
    assert.match((await compilePage(empty, { distRoot: path.join(tmp, 'dist') })).error, /至少要有一个 section/);
    const dup = makePage('dup', {
      board: { tabs: [{ id: 't1', sections: [sec('a', ['x'])] }, { id: 't2', sections: [sec('b', ['x'])] }] },
    });
    assert.match((await compilePage(dup, { distRoot: path.join(tmp, 'dist') })).error, /duplicate screen id "x"/);
  });
});

describe('范例页整页编译（checked-in content/previews/example）', () => {
  // 范例页是「新页照这个结构写」的门面（见页内 README），它自己必须始终可编译。
  // 钉住两件事：0 错误、9 屏齐全（与 board.json 的三段九屏一一对应，顺序一致）。
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  test('0 错误、9 屏齐全', async () => {
    const target = resolvePageTarget('example', { registry: null, root: REPO_ROOT });
    assert.ok(target, '范例页解析为模板页编译目标');
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, result.error || JSON.stringify(result.screens.filter((row) => !row.ok)));
    assert.deepEqual(result.screens.map((row) => row.id), [
      'beans', 'recipe', 'timer',
      'card-idle', 'card-selected', 'card-empty',
      'step-todo', 'step-now', 'step-done',
    ]);
    assert.deepEqual(result.screens.filter((row) => !row.ok), []);
  });
});

test('builtAt 与 mtime 同钟同精度（fs 时间戳）：写源 → 快编译完 → 查 stale 不误报', async () => {
  const target = makePage('built-at-wall-clock', {
    board: BASIC_BOARD,
    files: { 'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><p>好</p></div>;\n}\n' },
  });
  const distRoot = path.join(tmp, 'dist');
  await compilePage(target, { distRoot });
  const build = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
  // 两个前身都有钟域或精度缺陷：performance.timeOrigin + now() 是单调钟（NTP
  // 步进/回拨下与 mtime 差毫秒，BACKLOG 两条偶挂的根因）；Date.now() 是墙钟但
  // 整毫秒，同毫秒内后写的源（mtimeMs 亚毫秒浮点）严大于它——「写源 → 快编译
  // 完 → 查 stale」30-60% 误报 stale（R5b 三实测）。fs 自己的时间戳两边都对齐。
  assert.equal(Number.isInteger(build.builtAt), false, `builtAt 应取 build.json 的 mtime（亚毫秒浮点），实际 ${build.builtAt}`);
  assert.ok(build.builtAt <= Date.now() + 1000 && build.builtAt >= Date.now() - 60_000, `builtAt 在墙钟域内，实际 ${build.builtAt}`);
  // 编完之后源变新（mtime 在 builtAt 之后）必须判 stale：同钟域下这是恒等式。
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(target.pageDir, 'home.jsx'), future, future);
  assert.equal(distStatus(target.entryId, target.pageDir, { distRoot }).stale, true);
  // 快速连写 → 重编 → 立即查：必须 fresh（Date.now() 整毫秒的实现这里 30-60% 挂）。
  for (let i = 0; i < 10; i++) {
    fs.writeFileSync(path.join(target.pageDir, 'home.jsx'), `export default function Home() {\n  return <div className="ios-app"><p>第 ${i} 版</p></div>;\n}\n`);
    await compilePage(target, { distRoot });
    assert.equal(distStatus(target.entryId, target.pageDir, { distRoot }).stale, false, `第 ${i} 轮：编完即查不该 stale`);
  }
});

describe('skipFresh：启动全量只编 dist 过期的页', () => {
  // buildAllPages 经 listCompileTargets 找目标：这里登记一个指向 tmp 页的 dir 条目，
  // root 指到 tmp（没有 previews 清单，不会混进模板页）。
  function registryOf(target) {
    return { ok: true, path: path.join(tmp, 'registry.json'), entries: [{ id: target.entryId, kind: 'dir', path: target.pageDir }], projects: [], errors: [], warnings: [] };
  }

  const SIMPLE = {
    board: BASIC_BOARD,
    files: {
      'home.jsx': 'export default function Home() {\n  return <div className="ios-app"><p>一版</p></div>;\n}\n',
    },
  };

  test('dist 已是最新：整页跳过，build.json 与产物不再重写', async () => {
    const target = makePage('fresh-skip', SIMPLE);
    const distRoot = path.join(tmp, 'dist');
    await buildAllPages({ registry: registryOf(target), root: tmp, distRoot });
    const before = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    const htmlStat = fs.statSync(distFile(target, 'home.html'));
    const rows = await buildAllPages({ registry: registryOf(target), root: tmp, skipFresh: true, distRoot });
    assert.deepEqual(rows.map((row) => row.skipped), [true]);
    assert.equal(rows[0].ok, true);
    const after = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    assert.equal(after.builtAt, before.builtAt, '跳过的页不重写 build.json');
    assert.deepEqual(fs.statSync(distFile(target, 'home.html')).mtimeMs, htmlStat.mtimeMs);
  });

  test('改了帧源码的页重编，产物跟着更新', async () => {
    const target = makePage('fresh-stale', SIMPLE);
    const distRoot = path.join(tmp, 'dist');
    await buildAllPages({ registry: registryOf(target), root: tmp, distRoot });
    const before = JSON.parse(fs.readFileSync(distFile(target, 'build.json'), 'utf8'));
    fs.writeFileSync(path.join(target.pageDir, 'home.jsx'), SIMPLE.files['home.jsx'].replace('一版', '二版'));
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(target.pageDir, 'home.jsx'), later, later);
    const rows = await buildAllPages({ registry: registryOf(target), root: tmp, skipFresh: true, distRoot });
    assert.deepEqual(rows.map((row) => row.skipped === true), [false]);
    assert.ok(rows[0].builtAt > before.builtAt);
    assert.match(fs.readFileSync(distFile(target, 'home.html'), 'utf8'), /二版/);
  });

  test('板变了的页重编；没有 dist 的页照常编译', async () => {
    const target = makePage('fresh-board', SIMPLE);
    const distRoot = path.join(tmp, 'dist');
    // 没有 dist：skipFresh 不影响首次编译。
    const first = await buildAllPages({ registry: registryOf(target), root: tmp, skipFresh: true, distRoot });
    assert.deepEqual(first.map((row) => row.skipped === true), [false]);
    // 板变（mtime 抬到未来）：重编。
    const boardFile = path.join(target.pageDir, 'board.json');
    fs.utimesSync(boardFile, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    const rows = await buildAllPages({ registry: registryOf(target), root: tmp, skipFresh: true, distRoot });
    assert.deepEqual(rows.map((row) => row.skipped === true), [false]);
  });

  test('build.json 不是这份编译器编的（tool 章对不上）：重编', async () => {
    const target = makePage('fresh-tool', SIMPLE);
    const distRoot = path.join(tmp, 'dist');
    await buildAllPages({ registry: registryOf(target), root: tmp, distRoot });
    const buildFile = distFile(target, 'build.json');
    const build = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
    assert.equal(build.tool, compilerStamp(), 'build.json 记下编译器版本章');
    fs.writeFileSync(buildFile, JSON.stringify({ ...build, tool: '0123456789abcdef' }));
    assert.equal(distIsFresh(target, { distRoot }), false);
    const rows = await buildAllPages({ registry: registryOf(target), root: tmp, skipFresh: true, distRoot });
    assert.deepEqual(rows.map((row) => row.skipped === true), [false]);
  });

  test('带编译错误记录（源码在）的页视为过期，启动重编再报', async () => {
    const target = makePage('fresh-error', { board: BASIC_BOARD, files: { ...SIMPLE.files, 'broken.html': '<p>旧产物</p>' } });
    const distRoot = path.join(tmp, 'dist');
    // 板里只挂 home；先正常编一版，再手工把 broken 记成失败屏（源码记录在案）。
    await compilePage(target, { distRoot });
    const buildFile = distFile(target, 'build.json');
    const build = JSON.parse(fs.readFileSync(buildFile, 'utf8'));
    build.errors = { broken: 'broken.html: 故障' };
    build.sources.broken = { file: 'broken.html', mtimeMs: 1 };
    fs.writeFileSync(buildFile, JSON.stringify(build));
    const rows = await buildAllPages({ registry: registryOf(target), root: tmp, skipFresh: true, distRoot });
    assert.deepEqual(rows.map((row) => row.skipped === true), [false], '失败屏（源码在）重编');
  });
});

test('script / style 的字符串子节点不做实体转义（R4 B5 发现）：raw text 元素里是可执行的原文', async () => {
  const target = makePage('raw-text-elements', {
    board: BASIC_BOARD,
    files: {
      'home.jsx': [
        'export default function Home() {',
        '  const cond = false;',
        '  return (',
        '    <div className="ios-app">',
        '      <script>{`if (a < b && cond !== "x") { root.dataset.ok = "1"; }`}</script>',
        '      <style>{`.p > .c::before { content: "<&>"; }`}</style>',
        '      <p>{`1 < 2 & 3 > 2`}</p>',
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
    },
  });
  const distRoot = path.join(tmp, 'dist');
  const result = await compilePage(target, { distRoot });
  assert.equal(result.ok, true, JSON.stringify(result.screens));
  const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
  const script = html.match(/<script\b[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const style = html.match(/<style\b[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(script.includes('a < b && cond'), `script 里应是原文可执行形式，实际：${script}`);
  assert.ok(!script.includes('&lt;') && !script.includes('&amp;'), `script 不该有实体，实际：${script}`);
  assert.ok(style.includes('.p > .c') && style.includes('"<&>"'), `style 里应是原文，实际：${style}`);
  // 普通元素的文本照旧转义（HTML 语义不变）。
  assert.match(html, /<p[^>]*>1 &lt; 2 &amp; 3 > 2<\/p>/);
});

