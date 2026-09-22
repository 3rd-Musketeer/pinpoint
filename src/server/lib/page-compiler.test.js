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

  test('pinpoint/kit 解析成空模块（切片 2 再填）', async () => {
    const target = makePage('jsx-kit', {
      board: BASIC_BOARD,
      files: {
        'home.jsx': [
          'import \'pinpoint/kit\';',
          'export default function Home() {',
          '  return <div className="ios-app"><p>ok</p></div>;',
          '}',
          '',
        ].join('\n'),
      },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
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

describe('.html 帧', () => {
  test('无 include 的存量帧逐字节恒等', async () => {
    const fragment = '<div class="ios-app">\n  <div class="ios-page">恒等</div>\n</div>\n';
    const target = makePage('html-identity', { board: BASIC_BOARD, files: { 'home.html': fragment } });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true);
    assert.equal(fs.readFileSync(distFile(target, 'home.html'), 'utf8'), fragment);
  });

  test('include 在编译期展开一次，dist 里不再有 include', async () => {
    const kitRoot = path.join(tmp, 'kit');
    fs.mkdirSync(path.join(kitRoot, 'x-card'), { recursive: true });
    fs.writeFileSync(path.join(kitRoot, 'x-card', 'default.html'), '<div class="x-card" data-ios-slot="text">占位</div>');
    const target = makePage('html-include', {
      board: BASIC_BOARD,
      files: { 'home.html': '<div class="ios-app"><div data-ios-include="x-card/default" data-text="展开我"></div></div>\n' },
    });
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist'), kitRoot });
    assert.equal(result.ok, true);
    const html = fs.readFileSync(distFile(target, 'home.html'), 'utf8');
    assert.ok(!html.includes('data-ios-include'), html);
    assert.ok(html.includes('展开我'), html);
    assert.ok(html.includes('data-ios-from="x-card/default"'), html);
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
    const result = await renderScreenHtml(target, 'home', { distRoot });
    assert.equal(result.ok, true);
    assert.ok(result.html.includes('看'));
    assert.ok(result.html.includes('data-pp-id="home.jsx:2#1"'));
    assert.equal(fs.existsSync(distRoot), false);
    const missing = await renderScreenHtml(target, 'ghost', { distRoot });
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

  test('默认 root / kitRoot 指向真仓库（__dirname 深度的回归哨兵）', async () => {
    // page-compiler.js 住 src/server/lib/：ROOT 少退一级就会指到 src/ 下，
    // 模板页与 kit 组件全部静默落空（include 全烤成失败块）。
    assert.equal(resolvePageTarget('library')?.kind, 'template');
    assert.equal(resolvePageTarget('doc-library')?.kind, 'template');
    const target = resolvePageTarget('library');
    const result = await compilePage(target, { distRoot: path.join(tmp, 'dist') });
    assert.equal(result.ok, true, JSON.stringify(result.screens));
    const html = fs.readFileSync(distFile(target, 'msg-thread.html'), 'utf8');
    assert.ok(!html.includes('include 失败'), '默认 kitRoot 下 library 的 include 必须展开成功');
  });
});
