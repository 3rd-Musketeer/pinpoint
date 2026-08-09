import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createFrameNoteStore, FrameNoteError } from './frame-note-store.js';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-note-store-'));
  const pageDir = path.join(root, 'previews', 'demo');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, 'board.json'), JSON.stringify({
    sections: [{
      id: 'flow',
      title: 'Flow',
      layout: 'row',
      screens: ['start', { id: 'finish', title: 'Finish', note: 'Existing note' }],
    }],
  }, null, 2));
  return { root, store: createFrameNoteStore({ root }) };
}

test('frame note store reads and writes the board.json SSOT', (t) => {
  const { root, store } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const before = store.get('demo', 'start');
  assert.equal(before.note, '');
  const saved = store.update({
    pageId: 'demo',
    screenId: 'start',
    note: '  Scene: meeting ended.\r\nInteraction: tap the prompt.  ',
    baseRevision: before.revision,
  });
  assert.equal(saved.note, 'Scene: meeting ended.\nInteraction: tap the prompt.');
  assert.equal(store.get('demo', 'start').note, saved.note);

  const board = JSON.parse(fs.readFileSync(path.join(root, 'previews', 'demo', 'board.json'), 'utf8'));
  assert.deepEqual(board.sections[0].screens[0], { id: 'start', note: saved.note });
});

test('frame note store rejects stale revisions without overwriting newer source', (t) => {
  const { root, store } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stale = store.get('demo', 'finish');
  const current = store.update({
    pageId: 'demo',
    screenId: 'finish',
    note: 'Newer note',
    baseRevision: stale.revision,
  });
  assert.throws(
    () => store.update({
      pageId: 'demo',
      screenId: 'finish',
      note: 'Stale overwrite',
      baseRevision: stale.revision,
    }),
    (error) => (
      error instanceof FrameNoteError &&
      error.code === 'revision_conflict' &&
      error.details.note === 'Newer note' &&
      error.details.revision === current.revision
    ),
  );
  assert.equal(store.get('demo', 'finish').note, 'Newer note');
});

test('frame note store rejects unsafe ids and missing frames', (t) => {
  const { root, store } = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.throws(() => store.get('../demo', 'start'), (error) => error.code === 'invalid_id');
  assert.throws(() => store.get('demo', 'missing'), (error) => error.code === 'frame_not_found');
});
