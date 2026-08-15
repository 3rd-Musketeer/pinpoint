import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  ContractError,
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
    () => validateScreenFragment('<article class="report"><h1>Weekly</h1></article>', 'screen(legacy/report)', { shell: 'web' }),
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

test('page manifest normalizes the retired web mode and rejects unknown ones', () => {
  const manifest = validatePageManifest({
    defaultPage: 'doc-library',
    pages: [
      { id: 'doc-library', title: 'Example HTML', mode: 'html' },
      { id: 'legacy-web', title: 'Legacy Web', mode: 'web' },
    ],
  });
  assert.deepEqual(manifest.pages.map((page) => page.mode), ['html', 'html']);

  assert.throws(
    () => validatePageManifest({
      defaultPage: 'x',
      pages: [{ id: 'x', title: 'X', mode: 'print' }],
    }),
    /pages\[0\].mode.*expected "ios" or "html"/,
  );
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

  assert.deepEqual(board.sections[0].screens[0], { id: 'home', title: '', note: '', shell: 'app', src: '' });
  assert.equal(board.sections[0].screens[1].note, 'Explain this frame.');
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

test('component boards accept component slash variant ids', () => {
  const board = validateBoard({
    sections: [{
      id: 'button',
      title: 'Button',
      layout: 'row',
      screens: [{ id: 'button/catalog', src: 'components/button/catalog.html' }],
    }],
  }, { pageId: 'components', allowComponentRefs: true });

  assert.equal(board.sections[0].screens[0].id, 'button/catalog');
});

test('checked-in preview boards satisfy the manifest contract', () => {
  const root = new URL('../../', import.meta.url);
  const manifest = validatePageManifest(JSON.parse(fs.readFileSync(new URL('previews/_index.json', root))));
  for (const page of manifest.pages) {
    const board = JSON.parse(fs.readFileSync(new URL(`previews/${page.id}/board.json`, root)));
    validateBoard(board, {
      pageId: page.id,
      defaultShell: page.mode === 'html' ? 'doc' : 'app',
    });
  }
});

test('board normalizes legacy web shell screens to doc (2026-08-16 阶段 2)', () => {
  const board = validateBoard({
    sections: [{
      id: 'site',
      title: 'Site',
      layout: 'row',
      shell: 'web',
      screens: [{ id: 'hero', title: 'Hero', shell: 'web' }],
    }],
  }, { pageId: 'legacy-web', defaultShell: 'web' });
  assert.equal(board.sections[0].shell, 'doc');
  assert.equal(board.sections[0].screens[0].shell, 'doc');
});
