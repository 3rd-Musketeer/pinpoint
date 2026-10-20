import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ContractError,
  findRetiredVariantGroup,
  mergeSitePages,
  registryToPages,
  validateBoard,
  validatePageManifest,
  validateScreenFragment,
} from './preview-contracts.js';

test('screen fragment contract rejects the dev server fallback document', () => {
  assert.throws(
    () => validateScreenFragment('<!doctype html><html><head></head><body><div id="wbroot"></div></body></html>', 'screen(example/missing)'),
    (error) => error instanceof ContractError
      && error.message.includes('screen(example/missing)')
      && error.message.includes('full HTML document'),
  );
});

test('screen fragment contract accepts app and legacy phone fragments', () => {
  assert.equal(
    validateScreenFragment('<div class="ios-app"><div class="ios-page"></div></div>'),
    '<div class="ios-app"><div class="ios-page"></div></div>',
  );
  assert.equal(
    validateScreenFragment('<div class="ios-stage"><div class="ios-device"></div></div>'),
    '<div class="ios-stage"><div class="ios-device"></div></div>',
  );
});

test('screen fragment contract applies the ios wrapper check to every inlined shell', () => {
  // web 壳退役（2026-08-16 阶段 2）后不再有裸 fragment 旁路：内联进画板的
  // fragment 都要带 ios 包装；完整文档走 doc shell（iframe，不进本校验）。
  assert.throws(
    () => validateScreenFragment('<article class="report"></article>'),
    (error) => error instanceof ContractError && error.message.includes('ios-app'),
  );
  assert.throws(
    () => validateScreenFragment('<article class="report"><h1>Weekly</h1></article>', 'screen(legacy/report)', { shell: 'app' }),
    (error) => error instanceof ContractError && error.message.includes('ios-app'),
  );
});

test('page manifest owns ordered titles, modes, and a listed default page', () => {
  const manifest = validatePageManifest({
    defaultPage: 'library',
    pages: [
      { id: 'library', title: 'Example Library' },
      { id: 'doc-library', title: 'Example HTML', mode: 'html' },
      { id: 'other-page', title: 'Time Insight', mode: 'ios' },
    ],
  });

  assert.deepEqual(manifest.pages.map((page) => page.id), ['library', 'doc-library', 'other-page']);
  assert.deepEqual(manifest.pages.map((page) => page.mode), ['ios', 'html', 'ios']);
  assert.equal(manifest.defaultPage, 'library');
});

test('page manifest rejects modes other than ios and html', () => {
  for (const mode of ['print', 'web']) {
    assert.throws(
      () => validatePageManifest({
        defaultPage: 'x',
        pages: [{ id: 'x', title: 'X', mode }],
      }),
      /pages\[0\].mode.*expected "ios" or "html"/,
    );
  }
});

test('doc shell survives board validation and inherits from its section', () => {
  const board = validateBoard({
    sections: [{
      id: 'report',
      title: '汇报页',
      layout: 'column',
      shell: 'doc',
      screens: [{ id: 'sample-report', title: 'Sample Report' }],
    }],
  }, { pageId: 'doc-library', defaultShell: 'doc' });
  assert.equal(board.sections[0].shell, 'doc');
  assert.equal(board.sections[0].screens[0].shell, 'doc');
});

test('page manifest reports duplicate ids with a JSON path', () => {
  assert.throws(
    () => validatePageManifest({
      defaultPage: 'library',
      pages: [
        { id: 'library', title: 'One' },
        { id: 'library', title: 'Two' },
      ],
    }),
    (error) => error instanceof ContractError && error.message.includes('pages[1].id'),
  );
});

test('board rejects the legacy flat shape instead of rendering an empty component state', () => {
  assert.throws(
    () => validateBoard({ id: 'legacy', screens: ['home'] }, { pageId: 'legacy' }),
    (error) => error instanceof ContractError && error.message.includes('sections'),
  );
});

test('board normalizes valid screen entries and rejects duplicate screen ids', () => {
  const board = validateBoard({
    title: 'ignored legacy title',
    sections: [{
      id: 'main',
      title: 'Main',
      layout: 'row',
      screens: ['home', { id: 'detail', title: 'Detail', note: 'Explain this frame.', shell: 'lock' }],
    }],
  }, { pageId: 'library' });

  assert.deepEqual(board.sections[0].screens[0], { id: 'home', title: '', shell: 'app', role: 'product', src: '' });
  assert.equal(Object.hasOwn(board.sections[0].screens[1], 'note'), false);
  assert.throws(
    () => validateBoard({
      sections: [
        { id: 'one', title: 'One', layout: 'row', screens: ['home'] },
        { id: 'two', title: 'Two', layout: 'column', screens: ['home'] },
      ],
    }, { pageId: 'library' }),
    (error) => error instanceof ContractError && error.message.includes('sections[1].screens[0]'),
  );
});

test('checked-in preview boards satisfy the manifest contract', () => {
  const root = new URL('../../../content/', import.meta.url);
  const manifest = validatePageManifest(JSON.parse(fs.readFileSync(new URL('previews/_index.json', root))));
  for (const page of manifest.pages) {
    const board = JSON.parse(fs.readFileSync(new URL(`previews/${page.id}/board.json`, root)));
    validateBoard(board, {
      pageId: page.id,
      defaultShell: page.mode === 'html' ? 'doc' : 'app',
    });
  }
});

test('board rejects shells outside app / lock / doc / comp', () => {
  assert.throws(
    () => validateBoard({
      sections: [{
        id: 'site',
        title: 'Site',
        layout: 'row',
        screens: [{ id: 'hero', title: 'Hero', shell: 'web' }],
      }],
    }, { pageId: 'legacy-web' }),
    /expected "app", "lock", "doc", or "comp"/,
  );
});

test('screen role: 默认 product、收 draft、非法值报错（2026-08-16f 阶段 6）', () => {
  const board = validateBoard({
    sections: [{
      id: 'writeup',
      title: '文稿',
      layout: 'column',
      shell: 'doc',
      screens: [
        { id: 'delivered', title: '终版' },
        { id: 'polish', title: '打磨稿', role: 'draft' },
      ],
    }],
  }, { pageId: 'weekly', defaultShell: 'doc' });
  assert.equal(board.sections[0].screens[0].role, 'product');
  assert.equal(board.sections[0].screens[1].role, 'draft');

  // 字符串速记屏同样补默认 role
  const quick = validateBoard({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: ['home'] }],
  }, { pageId: 'library' });
  assert.equal(quick.sections[0].screens[0].role, 'product');

  assert.throws(
    () => validateBoard({
      sections: [{
        id: 'main',
        title: 'Main',
        layout: 'row',
        screens: [{ id: 'home', role: 'final' }],
      }],
    }, { pageId: 'library' }),
    (error) => error instanceof ContractError
      && error.message.includes('sections[0].screens[0].role')
      && error.message.includes('expected "product" or "draft"'),
  );
});

test('retired section note is ignored by board validation', () => {
  const board = validateBoard({
    sections: [{
      id: 'flow',
      title: 'Flow',
      note: '图例：直通带 = 照常；斜带 = 挤占。',
      layout: 'row',
      screens: ['home'],
    }],
  }, { pageId: 'library' });
  assert.equal(Object.hasOwn(board.sections[0], 'note'), false);

  const bare = validateBoard({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: ['home'] }],
  }, { pageId: 'library' });
  assert.equal(Object.hasOwn(bare.sections[0], 'note'), false);
});

test('title 规矩：换行一律拒绝', () => {
  assert.throws(
    () => validateBoard({
      sections: [{ id: 'main', title: '第一行\n第二行', layout: 'row', screens: ['home'] }],
    }, { pageId: 'library' }),
    (error) => error instanceof ContractError
      && error.message.includes('sections[0].title')
      && error.message.includes('single-line'),
  );
  assert.throws(
    () => validateBoard({
      sections: [{ id: 'main', title: 'Main', layout: 'row', screens: [{ id: 'home', title: '甲\n乙' }] }],
    }, { pageId: 'library' }),
    (error) => error instanceof ContractError
      && error.message.includes('sections[0].screens[0].title')
      && error.message.includes('single-line'),
  );
  assert.throws(
    () => validatePageManifest({
      defaultPage: 'x',
      pages: [{ id: 'x', title: '甲\n乙' }],
    }),
    (error) => error instanceof ContractError && error.message.includes('pages[0].title'),
  );
});

test('comp section（pp2 切片 2）：shell "comp" 放行，comp/props 条目归一，title 缺省用 id', () => {
  const board = validateBoard({
    sections: [{
      id: 'composer', title: 'Composer', layout: 'row', shell: 'comp',
      screens: [
        { id: 'composer-pill', comp: 'Composer', props: { state: 'pill' } },
        { id: 'composer-bar', title: 'bar', comp: 'Composer', shell: 'comp' },
      ],
    }],
  }, { pageId: 'p' });
  assert.equal(board.sections[0].shell, 'comp');
  assert.deepEqual(board.sections[0].screens[0], {
    id: 'composer-pill', title: 'composer-pill', shell: 'comp', role: 'product', src: '',
    comp: 'Composer', props: { state: 'pill' },
  });
  assert.deepEqual(board.sections[0].screens[1], {
    id: 'composer-bar', title: 'bar', shell: 'comp', role: 'product', src: '',
    comp: 'Composer', props: {},
  });
  // 普通屏不带 comp 字段
  const plain = validateBoard({
    sections: [{ id: 'main', title: 'Main', layout: 'row', screens: ['home'] }],
  }, { pageId: 'p' });
  assert.equal(Object.hasOwn(plain.sections[0].screens[0], 'comp'), false);
  // 非法形态照拦
  assert.throws(() => validateBoard({
    sections: [{ id: 's', title: 'S', layout: 'row', shell: 'comp', screens: [{ id: 'x', comp: 'not-a-name!' }] }],
  }), (e) => e instanceof ContractError && e.message.includes('.comp'));
  assert.throws(() => validateBoard({
    sections: [{ id: 's', title: 'S', layout: 'row', shell: 'comp', screens: [{ id: 'x', comp: 'C', props: [1] }] }],
  }), (e) => e instanceof ContractError && e.message.includes('.props'));
  // 未知壳值照拦
  assert.throws(() => validateBoard({
    sections: [{ id: 's', title: 'S', layout: 'row', shell: 'weird', screens: ['x'] }],
  }), (e) => e instanceof ContractError && e.message.includes('shell'));
});

test('validateBoard: screen 条目带 variants（已退役的变体组）报清楚的迁移提示', () => {
  const board = {
    sections: [{
      id: 's', title: 'S', layout: 'row',
      screens: ['a', { id: 'confirm', title: '确认', variants: [{ id: 'confirm-a' }, { id: 'confirm-b' }] }],
    }],
  };
  assert.throws(() => validateBoard(board, { pageId: 'p' }), (e) => (
    e instanceof ContractError
    && e.path === 'sections[0].screens[1]'
    && e.message.includes('screen confirm：变体组已退役（ADR 0040）；把变体摊平成同一个 section 里的普通 frame')
  ));
  assert.equal(findRetiredVariantGroup(board), 'confirm');
  assert.equal(findRetiredVariantGroup({ sections: [{ id: 's', screens: ['a', { id: 'b' }] }] }), null);
  assert.equal(findRetiredVariantGroup(null), null);
});

test('validateBoard：文章画布的派生 board（带 article）留下 article: true，手写 board 没有这个键', () => {
  const sections = [{ id: 'pages', title: '页面', layout: 'row', screens: [{ id: 'long', shell: 'doc' }] }];
  assert.equal(validateBoard({ article: { project: 'p', id: 'a', url: '/p/a/' }, sections }).article, true);
  assert.equal(Object.hasOwn(validateBoard({ sections }), 'article'), false);
});

// r5b B2：/registry 失败时 registrySitePages 的兜底形状（没有 pageTimes）不能把
// 整份清单合并炸掉 —— 那会把「registry 暂时读不到」放大成工作台整体死板，
// 「previews-only 降级」成空话。放回旧的行内合并（sitePages.pageTimes[page.id]
// 直接取属性）这条输入就是 TypeError。
test('mergeSitePages：registry 兜底形状（缺 pageTimes / 缺 articles）合并不炸，previews 页原样保留', () => {
  const manifest = validatePageManifest({ defaultPage: 'p1', pages: [{ id: 'p1', title: '模板页' }] });
  const merged = mergeSitePages(manifest, { pages: [], articles: [] });
  assert.deepEqual(merged.pages.map((p) => p.id), ['p1']);
  assert.deepEqual(merged.pageTimes, {});
  assert.deepEqual(merged.articles, []);
  // 完全不给 sitePages（undefined 字段全缺）也一样。
  const merged2 = mergeSitePages(validatePageManifest({ defaultPage: 'p2', pages: [{ id: 'p2', title: 'P2' }] }), undefined);
  assert.deepEqual(merged2.pages.map((p) => p.id), ['p2']);
});

test('mergeSitePages：registry 条目并入、pageTimes 灌进行、同 id previews 优先、articles 滤掉撞名', () => {
  const manifest = validatePageManifest({ defaultPage: 'p1', pages: [{ id: 'p1', title: '模板页' }] });
  const merged = mergeSitePages(manifest, {
    pages: [
      { id: 'p1', title: '撞名的登记页', kind: 'dir', site: true },
      { id: 'reg-dir', title: '登记页', kind: 'dir', site: true },
    ],
    articles: [
      { id: 'proj_a', title: '文章', kind: 'article', site: true },
      { id: 'p1', title: '撞名文章', kind: 'article', site: true },
    ],
    pageTimes: { 'reg-dir': { mtime: 1234, addedAt: 9 } },
  });
  assert.deepEqual(merged.pages.map((p) => p.id), ['p1', 'reg-dir']);
  assert.equal(merged.pages[0].title, '模板页'); // previews page with the same id wins
  assert.equal(merged.pages[1].mtime, 1234);
  assert.equal(merged.pages[1].addedAt, 9);
  assert.deepEqual(merged.articles.map((p) => p.id), ['proj_a']);
});

test('registryToPages：dir/file 收进 pages，pinpoint 自身与陌生 kind 不收，缺 pageTimes 兜 {}', () => {
  const out = registryToPages({
    entries: [
      { id: 'pinpoint', kind: 'dir' },
      { id: 'reg', kind: 'dir', title: '登记', mtime: 5 },
      { id: 'file1', kind: 'file' },
      { id: 'weird', kind: 'project' },
      null,
    ],
    articles: [{ id: 'proj_a' }, { title: '没有 id 的不算' }, null],
  });
  assert.deepEqual(out.pages.map((p) => p.id), ['reg', 'file1']);
  assert.deepEqual(out.articles.map((p) => p.id), ['proj_a']);
  assert.deepEqual(out.pageTimes, {});
  assert.deepEqual(registryToPages(null).pageTimes, {});
});
