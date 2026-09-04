import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  OfflinePageExportError,
  bundleHtmlAssets,
  buildOfflineShareHtml,
} from './offline-page-export.js';

function fixtureDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-offline-export-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('bundleHtmlAssets inlines local CSS, images, and preview modules', async (t) => {
  const root = fixtureDir(t);
  fs.mkdirSync(path.join(root, 'icons'));
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');
  fs.writeFileSync(path.join(root, 'screen.css'), '.hero{background:url("./icons/dot.svg")}');
  fs.writeFileSync(path.join(root, 'screen.js'), 'export default function mount(root){root.dataset.ready="yes"}');
  fs.writeFileSync(path.join(root, 'icons', 'dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

  const bundled = await bundleHtmlAssets([
    '<style>@import url("/sites/demo/screen.css");</style>',
    '<img src="/sites/demo/icons/dot.svg" alt="">',
    '<script src="/sites/demo/screen.js" type="module" data-preview-script></script>',
  ].join('\n'), {
    baseFile: path.join(root, 'screen.html'),
    entryRoot: root,
    entryId: 'demo',
    pinpointRoot: root,
  });

  assert.match(bundled.html, /\.hero\{background:url\("data:image\/svg\+xml;base64,/);
  assert.match(bundled.html, /<img src="data:image\/svg\+xml;base64,/);
  assert.match(bundled.html, /data-preview-script[^>]*>export default function mount/);
  assert.doesNotMatch(bundled.html, /\/sites\/demo\//);
  assert.deepEqual(bundled.remoteResources, []);
});

test('bundleHtmlAssets inlines kit assets served from /kits/', async (t) => {
  const root = fixtureDir(t);
  const pinpointRoot = fixtureDir(t);
  fs.mkdirSync(path.join(pinpointRoot, 'content', 'kits', 'ios'), { recursive: true });
  fs.writeFileSync(path.join(pinpointRoot, 'content', 'kits', 'ios', 'ios-kit.css'), '.ios-app{color:red}');
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');

  const bundled = await bundleHtmlAssets('<link rel="stylesheet" href="/kits/ios/ios-kit.css">', {
    baseFile: path.join(root, 'screen.html'),
    entryRoot: root,
    entryId: 'demo',
    pinpointRoot,
  });

  assert.match(bundled.html, /<style>\.ios-app\{color:red\}<\/style>/);
  assert.doesNotMatch(bundled.html, /\/kits\/ios\//);
  assert.deepEqual(bundled.remoteResources, []);
});

test('bundleHtmlAssets automatically inlines static assets from another registered page', async (t) => {
  const root = fixtureDir(t);
  const sharedRoot = fixtureDir(t);
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');
  fs.writeFileSync(path.join(sharedRoot, 'theme.css'), '.hero{background:url("./dot.svg")}');
  fs.writeFileSync(path.join(sharedRoot, 'dot.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  const registry = {
    resolve(id) {
      return id === 'shared-assets'
        ? { id, kind: 'dir', path: sharedRoot }
        : null;
    },
  };

  const bundled = await bundleHtmlAssets([
    '<style>@import url("/sites/shared-assets/theme.css");</style>',
    '<img src="/sites/shared-assets/dot.svg" alt="">',
  ].join('\n'), {
    baseFile: path.join(root, 'screen.html'),
    entryRoot: root,
    entryId: 'demo',
    pinpointRoot: root,
    registry,
  });

  assert.match(bundled.html, /\.hero\{background:url\("data:image\/svg\+xml;base64,/);
  assert.match(bundled.html, /<img src="data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(bundled.html, /\/sites\/shared-assets\//);
  assert.deepEqual(bundled.remoteResources, []);
});

test('bundleHtmlAssets still blocks resources owned by a registered online page', async (t) => {
  const root = fixtureDir(t);
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');
  const registry = {
    resolve(id) {
      return id === 'live-app'
        ? { id, kind: 'url', url: 'https://app.example' }
        : null;
    },
  };

  await assert.rejects(
    bundleHtmlAssets('<img src="/sites/live-app/icon.svg" alt="">', {
      baseFile: path.join(root, 'screen.html'),
      entryRoot: root,
      entryId: 'demo',
      pinpointRoot: root,
      registry,
    }),
    (error) => error instanceof OfflinePageExportError && error.code === 'runtime_network',
  );
});

test('bundleHtmlAssets rejects a foreign-page symlink that escapes its registered directory', async (t) => {
  const root = fixtureDir(t);
  const sharedRoot = fixtureDir(t);
  const outsideRoot = fixtureDir(t);
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');
  fs.writeFileSync(path.join(outsideRoot, 'secret.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  fs.symlinkSync(path.join(outsideRoot, 'secret.svg'), path.join(sharedRoot, 'shortcut.svg'));
  const registry = {
    resolve(id) {
      return id === 'shared-assets'
        ? { id, kind: 'dir', path: sharedRoot }
        : null;
    },
  };

  await assert.rejects(
    bundleHtmlAssets('<img src="/sites/shared-assets/shortcut.svg" alt="">', {
      baseFile: path.join(root, 'screen.html'),
      entryRoot: root,
      entryId: 'demo',
      pinpointRoot: root,
      registry,
    }),
    (error) => error instanceof OfflinePageExportError && error.code === 'asset_escape',
  );
});

test('bundleHtmlAssets reports exact HTTPS bytes and requires matching approval', async (t) => {
  const root = fixtureDir(t);
  const url = 'https://assets.example/prototype.svg';
  const fetchRemote = async (input) => {
    assert.equal(input, url);
    return new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
      headers: { 'content-type': 'image/svg+xml' },
    });
  };
  const source = `<img src="${url}" alt="">`;
  const inspected = await bundleHtmlAssets(source, {
    baseFile: path.join(root, 'screen.html'), entryRoot: root, entryId: 'demo', pinpointRoot: root,
    fetchRemote,
  });
  assert.equal(inspected.remoteResources.length, 1);
  assert.equal(inspected.remoteResources[0].url, url);
  assert.equal(inspected.remoteResources[0].origin, 'https://assets.example');
  assert.equal(inspected.remoteResources[0].size, 46);
  assert.match(inspected.remoteResources[0].sha256, /^[a-f0-9]{64}$/);

  await assert.rejects(
    bundleHtmlAssets(source, {
      baseFile: path.join(root, 'screen.html'), entryRoot: root, entryId: 'demo', pinpointRoot: root,
      fetchRemote, approvals: [{ url, sha256: 'wrong' }],
    }),
    (error) => error instanceof OfflinePageExportError && error.code === 'remote_changed',
  );

  const approved = await bundleHtmlAssets(source, {
    baseFile: path.join(root, 'screen.html'), entryRoot: root, entryId: 'demo', pinpointRoot: root,
    fetchRemote, approvals: inspected.remoteResources,
  });
  assert.match(approved.html, /src="data:image\/svg\+xml;base64,/);
});

test('bundleHtmlAssets blocks paths outside the registered entry', async (t) => {
  const root = fixtureDir(t);
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');
  await assert.rejects(
    bundleHtmlAssets('<img src="/sites/demo/../secret.png">', {
      baseFile: path.join(root, 'screen.html'), entryRoot: root, entryId: 'demo', pinpointRoot: root,
    }),
    (error) => error instanceof OfflinePageExportError && error.code === 'asset_escape',
  );
});

test('bundleHtmlAssets blocks unresolved runtime resources and inline network code', async (t) => {
  const root = fixtureDir(t);
  fs.writeFileSync(path.join(root, 'screen.html'), '<div></div>');
  const options = { baseFile: path.join(root, 'screen.html'), entryRoot: root, entryId: 'demo', pinpointRoot: root };
  await assert.rejects(
    bundleHtmlAssets('<script src="/sites/demo/unmarked.js"></script>', options),
    (error) => error instanceof OfflinePageExportError && error.code === 'runtime_network',
  );
  await assert.rejects(
    bundleHtmlAssets('<script>fetch("/api/data")</script>', options),
    (error) => error instanceof OfflinePageExportError && error.code === 'runtime_network',
  );
});

test('buildOfflineShareHtml keeps section rows, outline targets, and no Pinpoint runtime URLs', () => {
  const html = buildOfflineShareHtml({
    pageId: 'demo',
    title: 'Demo',
    sections: [{
      id: 'start', title: '开始', ref: 'A', screens: [
        { id: 'one', title: '第一屏', ref: 'A1', html: '<div class="wb-screen"><div class="ios-stage"></div></div>' },
        { id: 'two', title: '第二屏', ref: 'A2', html: '<div class="wb-screen"><div class="ios-stage"></div></div>' },
      ],
    }],
    workbenchCss: ':root{--wb-fg:#111}',
    iosCss: '.ios-stage{width:438px;height:910px}',
    iosKitJs: 'window.iOSKit={refresh:function(){}}',
    frameBootJs: 'document.documentElement.dataset.boot="done"',
  });

  assert.match(html, /<aside class="share-outline"/);
  assert.match(html, /href="#section-start"/);
  assert.match(html, /href="#frame-one"/);
  assert.match(html, /class="share-frame-row"/);
  assert.match(html, /data-frame-count="2"/);
  assert.match(html, /transform:scale\(\.5\)/);
  assert.match(html, /html,body\{[^}]*overflow:visible/);
  assert.doesNotMatch(html, /annotate\.js|pinpoint\.localhost|\/sites\//);
});
