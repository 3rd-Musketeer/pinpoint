import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { compilePage } from './page-compiler.js';
import { planPageRecompile, planRecompile } from './recompile-plan.js';

let tmp;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-recompile-plan-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const SCREENS = ['home', 'detail', 'about'];

/** 上一次全绿 build.json 的手写样子：home/detail 共享 components/Shared.jsx。 */
function greenBuild() {
  return {
    builtAt: 1000,
    sources: {
      home: { file: 'home.jsx', mtimeMs: 900, deps: [{ file: 'components/Shared.jsx', mtimeMs: 800 }] },
      detail: { file: 'detail.jsx', mtimeMs: 900, deps: [{ file: 'components/Shared.jsx', mtimeMs: 800 }] },
      about: { file: 'about.html', mtimeMs: 900 },
    },
    errors: {},
  };
}

const abs = (rel) => path.join(tmp, 'page', ...rel.split('/'));

describe('planRecompile：该编的屏', () => {
  test('变更文件是某屏的 file → 只编该屏', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('detail.jsx')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['detail'] });
  });

  test('共享依赖命中多屏：全部命中的屏都重编，没引用的屏不动', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('components/Shared.jsx')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['home', 'detail'] });
  });

  test('kit 印章这类页外依赖（../ 相对链）也能认领到屏', () => {
    const build = greenBuild();
    build.sources.about = { file: 'about.html', mtimeMs: 900, deps: [{ file: '../content/kits/ios/jsx/Bubble.jsx', mtimeMs: 800 }] };
    const plan = planRecompile({ build, changedFiles: [path.join(tmp, 'content', 'kits', 'ios', 'jsx', 'Bubble.jsx')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['about'] });
  });

  test('一批多个文件命中不同屏：并集一次编齐', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('detail.jsx'), abs('about.html')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: false, screens: ['detail', 'about'] });
  });
});

describe('planRecompile：一律全编', () => {
  test('没有 build.json', () => {
    assert.deepEqual(planRecompile({ build: null, changedFiles: [abs('home.jsx')], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('build.json 解析失败（调用方传进来的残缺对象同罪）', () => {
    assert.deepEqual(planRecompile({ build: { builtAt: 1 }, changedFiles: [abs('home.jsx')], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('board.json 变了 → 全编', () => {
    const plan = planRecompile({ build: greenBuild(), changedFiles: [abs('home.jsx'), abs('board.json')], screenIds: SCREENS, pageDir: abs('') });
    assert.deepEqual(plan, { all: true });
  });

  test('屏增删：板屏清单与 build.json 记录不一致 → 全编', () => {
    // 加了一屏
    assert.deepEqual(
      planRecompile({ build: greenBuild(), changedFiles: [abs('home.jsx')], screenIds: [...SCREENS, 'extra'], pageDir: abs('') }),
      { all: true },
    );
    // 删了一屏
    assert.deepEqual(
      planRecompile({ build: greenBuild(), changedFiles: [abs('home.jsx')], screenIds: ['home', 'detail'], pageDir: abs('') }),
      { all: true },
    );
  });

  test('变更文件不属于任何屏的 file/deps 但在页目录里（新增文件/assets/样式）→ 全编', () => {
    for (const rel of ['new-screen.jsx', 'pk.css', 'sidecar.js', 'components/board.json']) {
      assert.deepEqual(
        planRecompile({ build: greenBuild(), changedFiles: [abs(rel)], screenIds: SCREENS, pageDir: abs('') }),
        { all: true },
        rel,
      );
    }
  });

  test('上次编译有失败屏 → 全编', () => {
    const build = greenBuild();
    build.errors.about = 'about.html: 顶层只允许 import';
    assert.deepEqual(planRecompile({ build, changedFiles: [abs('home.jsx')], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('fs.watch 拿不到文件名（null）→ 全编', () => {
    assert.deepEqual(planRecompile({ build: greenBuild(), changedFiles: [null], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });

  test('空变更批次 → 全编（空列表跳过编译会让 dist 假 fresh）', () => {
    assert.deepEqual(planRecompile({ build: greenBuild(), changedFiles: [], screenIds: SCREENS, pageDir: abs('') }), { all: true });
  });
});

describe('planPageRecompile：读盘包装', () => {
  function makePage(name, files) {
    const pageDir = path.join(tmp, name);
    for (const [rel, content] of Object.entries(files)) {
      const file = path.join(pageDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
    return { entryId: name, pageDir, urlBase: `/sites/${name}/`, kind: 'dir' };
  }

  const BOARD = {
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] }],
  };

  test('真页 + 真 build.json：只编命中的屏；板读不到回落全编', async () => {
    const target = makePage('real-page', {
      'board.json': JSON.stringify(BOARD),
      'a.html': '<div class="ios-app">a</div>\n',
      'b.html': '<div class="ios-app">b</div>\n',
    });
    const distRoot = path.join(tmp, 'dist');
    await compilePage(target, { distRoot });
    const changed = path.join(target.pageDir, 'a.html');
    // 改 a → 计划是 [a]；拿这个计划走增量编译，b 的产物不被重写。
    const before = fs.statSync(path.join(distRoot, 'real-page', 'b.html')).mtimeMs;
    const plan = planPageRecompile(target, [changed], { distRoot });
    assert.deepEqual(plan, { all: false, screens: ['a'] });
    await compilePage(target, { distRoot, onlyScreens: plan.screens });
    assert.equal(fs.statSync(path.join(distRoot, 'real-page', 'b.html')).mtimeMs, before);

    // 板没了 → 全编（compilePage 那边会报板错误，同一条保守路）。
    fs.rmSync(path.join(target.pageDir, 'board.json'));
    assert.deepEqual(planPageRecompile(target, [changed], { distRoot }), { all: true });
  });
});
