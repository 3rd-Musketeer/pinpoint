import test from 'node:test';
import assert from 'node:assert/strict';

import { embedParked, pauseEmbed, registerEmbedPark, reportEmbedPark, resetEmbedPark, resumeEmbed } from './embed-park.js';

test('停驻立即暂停，但回执要等首装落定；恢复撤销在途的停驻回执', async () => {
  resetEmbedPark();
  let settle;
  const boot = new Promise((resolve) => { settle = resolve; });
  const reports = [];
  const report = reportEmbedPark(() => boot, (paused) => reports.push(paused));
  const first = report(true);
  assert.equal(embedParked(), true);
  await Promise.resolve();
  assert.deepEqual(reports, []);
  await report(false);
  settle();
  await first;
  assert.equal(embedParked(), false);
  assert.deepEqual(reports, [false]);
  await report(true);
  assert.deepEqual(reports, [false, true]);
});

test('pause runs every duty once; pausing again does not drop the backlog resume will replay', () => {
  resetEmbedPark();
  const log = [];
  registerEmbedPark({
    pause() { log.push('a-pause'); },
    resume() { log.push('a-resume'); },
  });
  registerEmbedPark({
    pause() { log.push('b-pause'); },
    resume() { log.push('b-resume'); },
  });
  assert.equal(embedParked(), false);
  pauseEmbed();
  pauseEmbed();
  assert.equal(embedParked(), true);
  assert.deepEqual(log, ['a-pause', 'b-pause']);
  resumeEmbed();
  resumeEmbed();
  assert.equal(embedParked(), false);
  assert.deepEqual(log, ['a-pause', 'b-pause', 'a-resume', 'b-resume']);
});

test('a duty registered while parked is paused immediately and resumed with the rest', () => {
  resetEmbedPark();
  const log = [];
  pauseEmbed();
  const drop = registerEmbedPark({
    pause() { log.push('late-pause'); },
    resume() { log.push('late-resume'); },
  });
  assert.deepEqual(log, ['late-pause']);
  resumeEmbed();
  assert.deepEqual(log, ['late-pause', 'late-resume']);
  drop();
  pauseEmbed();
  assert.deepEqual(log, ['late-pause', 'late-resume']);
});

test('a pause that arrives before any duty is registered pauses the duty when it registers', () => {
  resetEmbedPark();
  const log = [];
  pauseEmbed();
  assert.equal(embedParked(), true);
  registerEmbedPark({
    pause() { log.push('pause'); },
    resume() { log.push('resume'); },
  });
  assert.deepEqual(log, ['pause']);
  // 意图已经落到登记上：再暂停不重复，恢复照常补做。
  pauseEmbed();
  assert.deepEqual(log, ['pause']);
  resumeEmbed();
  assert.deepEqual(log, ['pause', 'resume']);
  assert.equal(embedParked(), false);
});

test('one duty failing does not stop the others; an unregistered shape is ignored', () => {
  resetEmbedPark();
  const log = [];
  registerEmbedPark({ pause() { throw new Error('boom'); }, resume() { log.push('bad-resume'); } });
  registerEmbedPark({ pause() { log.push('ok-pause'); }, resume() { throw new Error('boom'); } });
  registerEmbedPark({ pause() { log.push('tail-pause'); }, resume() { log.push('tail-resume'); } });
  assert.equal(typeof registerEmbedPark({ pause() {} }), 'function');
  pauseEmbed();
  resumeEmbed();
  assert.deepEqual(log, ['ok-pause', 'tail-pause', 'bad-resume', 'tail-resume']);
});

test('a duty that unregisters itself during resume does not make the next duty skip its resume', () => {
  resetEmbedPark();
  const log = [];
  registerEmbedPark({ pause() {}, resume() { log.push('a'); } });
  const releaseB = registerEmbedPark({ pause() {}, resume() { releaseB(); log.push('b'); } });
  registerEmbedPark({ pause() {}, resume() { log.push('c'); } });
  pauseEmbed();
  resumeEmbed();
  assert.deepEqual(log, ['a', 'b', 'c']);
  // 退订的那一处下一轮不再被调。
  pauseEmbed();
  resumeEmbed();
  assert.deepEqual(log, ['a', 'b', 'c', 'a', 'c']);
});
