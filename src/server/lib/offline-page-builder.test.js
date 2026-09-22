import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildOfflinePage } from './offline-page-builder.js';

test('buildOfflinePage assembles a registry iOS Page into one offline document', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-offline-page-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'board.json'), JSON.stringify({
    sections: [{
      id: 'flow', title: '流程', layout: 'row', screens: [{ id: 'first', title: '第一屏' }],
    }],
  }));
  fs.writeFileSync(path.join(root, 'first.html'), [
    '<div class="ios-app" data-pp-id="first.html:1@1" data-pp-comp="Home"><button data-choice data-pp-id="first.html:1@2">选择</button></div>',
    '<script type="module" data-preview-script>export default function mount(root){root.dataset.mounted="yes"}</script>',
  ].join('\n'));
  const entry = { id: 'offline-fixture', title: 'Offline Fixture', kind: 'dir', path: root, board: 'ios' };
  const registry = { resolve(id) { return id === entry.id ? entry : null; } };

  const result = await buildOfflinePage({ pageId: entry.id, registry, approvals: [] });

  assert.equal(result.sectionCount, 1);
  assert.equal(result.frameCount, 1);
  assert.equal(result.filename, 'offline-fixture__interactive.html');
  assert.match(result.html, /data-offline-page="offline-fixture"/);
  assert.match(result.html, /data-preview-kind="module"/);
  assert.match(result.html, /export default function mount/);
  assert.doesNotMatch(result.html, /src="\/(?:sites|kits|workbench)\//);
  // R8：内部锚点（源码文件名与标注地址）不进 handoff HTML。
  assert.doesNotMatch(result.html, /data-pp-(?:id|comp)=/);
  assert.match(result.html, /<div class="ios-app"><button data-choice>选择<\/button><\/div>/);
});

test('buildOfflinePage fetches a shared remote resource once per export', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-offline-page-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'board.json'), JSON.stringify({
    sections: [{ id: 'flow', title: 'Flow', layout: 'row', screens: [{ id: 'one' }, { id: 'two' }] }],
  }));
  const remoteUrl = 'https://assets.example/shared.svg';
  fs.writeFileSync(path.join(root, 'one.html'), `<div class="ios-app"><img src="${remoteUrl}"></div>`);
  fs.writeFileSync(path.join(root, 'two.html'), `<div class="ios-app"><img src="${remoteUrl}"></div>`);
  const entry = { id: 'remote-fixture', title: 'Remote Fixture', kind: 'dir', path: root, board: 'ios' };
  const registry = { resolve(id) { return id === entry.id ? entry : null; } };
  let fetchCount = 0;

  const result = await buildOfflinePage({
    pageId: entry.id,
    registry,
    fetchRemote: async () => {
      fetchCount += 1;
      return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', { headers: { 'content-type': 'image/svg+xml' } });
    },
  });

  assert.equal(fetchCount, 1);
  assert.equal(result.remoteResources.length, 1);
});

test('buildOfflinePage freezes static dependencies from another registered page', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-offline-page-'));
  const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-offline-shared-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  t.after(() => fs.rmSync(sharedRoot, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'board.json'), JSON.stringify({
    sections: [{ id: 'flow', title: 'Flow', layout: 'row', screens: [{ id: 'one' }] }],
  }));
  fs.writeFileSync(path.join(root, 'one.html'), [
    '<style>@import url("/sites/shared-style/theme.css");</style>',
    '<div class="ios-app"><img src="/sites/shared-style/icon.svg" alt=""></div>',
  ].join('\n'));
  fs.writeFileSync(path.join(sharedRoot, 'theme.css'), '.shared{color:#123456}');
  fs.writeFileSync(path.join(sharedRoot, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const pageEntry = { id: 'page', title: 'Page', kind: 'dir', path: root, board: 'ios' };
  const sharedEntry = { id: 'shared-style', title: 'Shared Style', kind: 'dir', path: sharedRoot, board: 'ios' };
  const registry = {
    resolve(id) {
      if (id === pageEntry.id) return pageEntry;
      if (id === sharedEntry.id) return sharedEntry;
      return null;
    },
  };

  const result = await buildOfflinePage({ pageId: pageEntry.id, registry, approvals: [] });

  assert.match(result.html, /\.shared\{color:#123456\}/);
  assert.match(result.html, /src="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(result.html, /\/sites\/shared-style\//);
  assert.deepEqual(result.remoteResources, []);
});
