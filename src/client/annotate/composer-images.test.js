// C2：贴图 / 删图不排自动保存，关页即丢。文本输入走 scheduleAutosave，图片两条入口也必须走。
// 依赖模块换成计数替身；DOM 只留 attachComposerImages 读到的那几个面。
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

globalThis.__imgCalls = { persist: 0 };

const STUBS = {
  'anchor.js': `
    export function markElementTargets() { return []; }
    export function normalizeElementTargets() {}
    export function backfillTargetPpIds() {}`,
  'marks.js': `
    export function contentToStorage(text) { return text; }
    export function ensureMarkId(m) { if (!m.id) m.id = 'id'; }
    export function extractMentionIds() { return []; }`,
  'persist.js': `
    export function persist() { globalThis.__imgCalls.persist++; }
    export function requestSync() {}`,
  'ui.js': `export function setStatus() {}`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL && context.parentURL.endsWith('/annotate/composer-images.js') && specifier.startsWith('./')) {
      const name = specifier.slice(2);
      if (STUBS[name]) return { url: 'stub:composer-images/' + name, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('stub:composer-images/')) {
      return { format: 'module', source: STUBS[url.slice('stub:composer-images/'.length)], shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

function el() {
  const node = {
    children: [],
    listeners: {},
    className: '',
    innerHTML: '',
    setAttribute() {},
    querySelector(sel) {
      if (!node._q) node._q = {};
      if (!node._q[sel]) node._q[sel] = el();
      return node._q[sel];
    },
    appendChild(child) { node.children.push(child); return child; },
    addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
  };
  return node;
}

globalThis.document = { createElement: () => el() };
globalThis.FileReader = class {
  readAsDataURL() {
    queueMicrotask(() => { this.result = 'data:image/png;base64,xx'; this.onload(); });
  }
};
globalThis.fetch = async () => ({ json: async () => ({ file: 'f1.png', path: 'images/f1.png' }) });

const { bind_composer_images, attachComposerImages, attachComposerAutosave } = await import('./composer-images.js');

function ctxFor() {
  return {
    SERVER: 'http://ann', PAGE: 'p', ENTRY: 'e', AUTOSAVE_MS: 600,
    activeComposer: null, marks: [], arrowFrom: null,
    CANVAS_MODE: false, canvasLedgerApplied: true, updateListeners: [],
  };
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function open(ctx, m, text) {
  bind_composer_images(ctx);
  const box = el();
  const ta = { value: text, addEventListener(type, fn) { (ta.listeners ||= {})[type] = fn; } };
  const composer = { box, ta, m, isNew: !text };
  ctx.activeComposer = composer;
  const draft = { changeOn: false, research: null, images: (m.images || []).slice() };
  attachComposerAutosave(composer, ta, m, draft);
  composer.takeSnapshot();
  const images = attachComposerImages(box, ta, m, composer);
  draft.images = images;
  return { box, ta, composer, images };
}

test('删掉已有截图会排自动保存，到点后账本里不再带这张图', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    globalThis.__imgCalls.persist = 0;
    const ctx = ctxFor();
    const m = { id: 'id2', n: 2, type: 'element', content: '改这里', images: [{ file: 'a.png', path: 'p' }] };
    ctx.marks = [m];
    const { box } = open(ctx, m, '改这里');
    const row = box.querySelector('#ann-imgs').children[0];
    row.querySelector('.x').listeners.click[0]();
    assert.equal(globalThis.__imgCalls.persist, 0, '点删除当下不写盘');
    mock.timers.tick(600);
    assert.equal(globalThis.__imgCalls.persist, 1);
    assert.equal(ctx.marks[0].images, undefined);
    assert.equal(ctx.marks[0].content, '改这里');
  } finally {
    mock.timers.reset();
  }
});

test('贴上截图且没有文字也会排自动保存，到点后图进账本', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    globalThis.__imgCalls.persist = 0;
    const ctx = ctxFor();
    const m = { id: 'id1', n: 1, type: 'element', content: '' };
    const { ta } = open(ctx, m, '');
    ta.listeners.paste({
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => ({}) }] },
      preventDefault() {},
    });
    await flush();
    assert.equal(globalThis.__imgCalls.persist, 0, '上传完成当下不写盘');
    mock.timers.tick(600);
    assert.equal(globalThis.__imgCalls.persist, 1);
    assert.equal(ctx.marks.length, 1);
    assert.deepEqual(ctx.marks[0].images, [{ file: 'f1.png', path: 'images/f1.png' }]);
  } finally {
    mock.timers.reset();
  }
});
