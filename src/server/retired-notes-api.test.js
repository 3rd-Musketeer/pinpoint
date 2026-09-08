import test from 'node:test';
import assert from 'node:assert/strict';
import retiredNotesApi from './retired-notes-api.js';

test('retired note routes reject reads and writes; other routes pass through', () => {
  let handle;
  retiredNotesApi().configureServer({ middlewares: { use(fn) { handle = fn; } } });
  for (const kind of ['frame', 'section']) {
    for (const method of ['GET', 'PUT']) {
      let body; const headers = {};
      const res = { setHeader(key, value) { headers[key] = value; }, end(value) { body = value; } };
      handle({ url: `/api/${kind}-notes/page/target`, method,
        get body() { assert.fail('retired handler must not read or persist request data'); } }, res, () => assert.fail('must not fall through'));
      assert.equal(res.statusCode, 410);
      assert.equal(headers['Content-Type'], 'application/json; charset=utf-8');
      assert.deepEqual(JSON.parse(body), { error: 'board_notes_removed' });
    }
  }
  let next = false;
  handle({ url: '/api/frame/page/target' }, {}, () => { next = true; });
  assert.ok(next);
});
