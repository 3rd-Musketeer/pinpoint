import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { removeBoardNotes } from './remove-board-notes.mjs';

test('board note migration backs up exact bytes, preserves other data, and is idempotent', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-board-notes-'));
  t.after(() => fs.rmSync(dir, {recursive:true, force:true}));
  const file = path.join(dir, 'board.json');
  const board = {title:'Keep page', sections:[{id:'a', note:'Retired section', screens:['one', {id:'two', title:'Keep title', note:'Retired', src:'two.html'}]}]};
  const original = JSON.stringify(board);
  fs.writeFileSync(file, original);
  assert.equal(removeBoardNotes(file).count, 2);
  assert.equal(fs.readFileSync(file,'utf8'), original);
  const result = removeBoardNotes(file, {backupDir:path.join(dir,'backup')});
  assert.equal(fs.readFileSync(result.backup,'utf8'), original);
  delete board.sections[0].note;
  delete board.sections[0].screens[1].note;
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')), board);
  assert.equal(removeBoardNotes(file, {backupDir:path.join(dir,'backup')}).count, 0);
  assert.equal(fs.readdirSync(path.join(dir,'backup')).length, 1);
});
