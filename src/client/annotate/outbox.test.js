// C1：从 bfcache 恢复时 pageshow 重连必须带 catchUp，否则离开期间的写入不可见。
// 依赖换成替身；只留 installLeaveHooks 读到的 window / document。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

globalThis.__outbox = { fetched: 0 };

const STUBS = {
  'marks.js': `
    export function docAnnotations(doc) { return doc.annotations || []; }
    export function ensureAllMarkIds() {}`,
  'persist.js': `
    export function applyRemoteDoc(doc) { globalThis.__outbox.applied = doc; }
    export function deferRemoteDoc() {}
    export function postSave() { return Promise.resolve(); }
    export function readLocalMarks() { return []; }
    export function rebaseOnto() {}
    export function requestSync() {}
    export function saveBody() { return {}; }
    export function setBase() {}
    export function writeLocalCache() {}`,
  'ui.js': `
    export function notify() {}
    export function setStatus() {}`,
  '../lib/save-request.js': `
    export function newSaveId() { return 's'; }
    export function onPageLeave() {}`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.endsWith('/annotate/outbox.js')) {
      const name = specifier.startsWith('./') ? specifier.slice(2) : specifier;
      if (STUBS[name]) return { url: 'stub:outbox/' + name, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:outbox/')) {
      return { format: 'module', source: STUBS[url.slice('stub:outbox/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

const listeners = {};
globalThis.window = {
  addEventListener(type, fn) { listeners[type] = fn; },
  frameElement: null,
};
globalThis.document = {};
globalThis.EventSource = class {
  constructor() { globalThis.__outbox.source = this; }
  close() {}
  addEventListener() {}
};
globalThis.fetch = async (url) => {
  globalThis.__outbox.fetched++;
  globalThis.__outbox.url = url;
  return { ok: true, json: async () => ({ revision: 4, annotations: [{ n: 1, content: '别处写入' }] }) };
};

const { bind_outbox, init_outbox, installLeaveHooks } = await import('./outbox.js');

function arm() {
  globalThis.__outbox.fetched = 0;
  globalThis.__outbox.applied = null;
  globalThis.__outbox.source = undefined;
  const ctx = {
    SERVER: 'http://ann', ENTRY: 'notes', PAGE: 'page-a', PAGE_KEY: 'page-a',
    eventSource: null, parentEventsOff: null, eventsParked: false, eventsConnected: true,
    serverOnline: false, syncEpoch: 1, ledgerSwitching: false, revision: 1,
    syncing: false, mutationVersion: 0, syncedMutationVersion: 0,
  };
  bind_outbox(ctx);
  init_outbox();
  installLeaveHooks();
  return ctx;
}

test('bfcache 恢复（pageshow persisted）重连后补读当前账本', async () => {
  const ctx = arm();
  listeners.pageshow({ persisted: true });
  ctx.eventSource.onopen();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(globalThis.__outbox.fetched, 1);
  assert.match(globalThis.__outbox.url, /\/annotations\/page-a\?entry=notes/);
  assert.equal(globalThis.__outbox.applied.revision, 4);
});

test('普通 pageshow（不是 bfcache）不重连、不补读', async () => {
  arm();
  listeners.pageshow({ persisted: false });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  assert.equal(globalThis.__outbox.fetched, 0);
  assert.equal(globalThis.__outbox.source, undefined);
});
