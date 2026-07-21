import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { ContractError, validateBoard, validatePageManifest } from './preview-contracts.js';

test('page manifest owns ordered titles and a listed default page', () => {
  const manifest = validatePageManifest({
    defaultPage: 'library',
    pages: [
      { id: 'library', title: 'Example Library' },
      { id: 'time-insight', title: 'Time Insight' },
    ],
  });

  assert.deepEqual(manifest.pages.map((page) => page.id), ['library', 'time-insight']);
  assert.equal(manifest.defaultPage, 'library');
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
      screens: ['home', { id: 'detail', title: 'Detail', shell: 'lock' }],
    }],
  }, { pageId: 'library' });

  assert.deepEqual(board.sections[0].screens[0], { id: 'home', title: '', shell: 'app', src: '' });
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
  const root = new URL('../', import.meta.url);
  const manifest = validatePageManifest(JSON.parse(fs.readFileSync(new URL('previews/_index.json', root))));
  for (const page of manifest.pages) {
    const board = JSON.parse(fs.readFileSync(new URL(`previews/${page.id}/board.json`, root)));
    validateBoard(board, { pageId: page.id });
  }
});
