/**
 * POST /registry/reload — the whole point of the shared registry store:
 * handlers that captured the registry at startup must see new entries after a
 * reload, for serving (/sites/), injection, and bucket routing alike. These
 * tests run one store through the annotate handler AND the sites handler to
 * prove the cross-plugin effect.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createAnnotateHandler } from './annotate-api.js';
import { loadRegistry } from './lib/registry.js';
import { createRegistryStore, writeRegistryFile } from './lib/registry-store.js';
import { createSitesHandler } from './sites-api.js';
import { mockReq, mockRes } from './test-harness.js';

function withFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-reload-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dataRoot = path.join(dir, 'data');
  const registryFile = path.join(dir, 'registry.json');
  const site = path.join(dir, 'mysite');
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><html><body><h1>mysite</h1></body></html>');
  writeRegistryFile(registryFile, { version: 1, entries: [] });

  const reloads = [];
  const store = createRegistryStore({ path: registryFile, root: dir, log: () => {} });
  const annotate = createAnnotateHandler({
    dataRoot,
    registry: store,
    onRegistryReload: (summary) => reloads.push(summary),
  });
  const sites = createSitesHandler({ registry: store });
  return { dataRoot, registryFile, site, store, annotate, sites, reloads };
}



async function call(handler, method, url, body) {
  const req = mockReq(method, url, body);
  const res = mockRes();
  const handled = await handler(req, res, url.split('?')[0]);
  return { handled, res };
}

test('reload makes a newly registered dir effective for /registry, /sites/, and bucket routing', async (t) => {
  const f = withFixture(t);

  // Before: unknown everywhere.
  assert.equal((await call(f.sites, 'GET', '/sites/mysite/')).res.statusCode, 404);
  assert.equal((await call(f.annotate, 'GET', '/annotations/x?entry=mysite')).res.statusCode, 400);

  // CLI writes the file out of band, then asks the service to reload.
  writeRegistryFile(f.registryFile, { version: 1, entries: [
    { id: 'pinpoint', title: 'pinpoint workbench', kind: 'dir', path: f.dataRoot },
    { id: 'mysite', title: 'My Site', kind: 'dir', path: f.site },
  ] });
  const reload = await call(f.annotate, 'POST', '/registry/reload');
  assert.equal(reload.res.statusCode, 200);
  assert.equal(reload.res.json.ok, true);
  assert.equal(reload.res.json.entries, 2);
  assert.equal(f.reloads.length, 1, 'onRegistryReload fired once');
  assert.equal(f.reloads[0].entries, 2);

  // GET /registry reads the fresh snapshot.
  const listed = await call(f.annotate, 'GET', '/registry');
  assert.deepEqual(listed.res.json.entries.map((e) => e.id), ['pinpoint', 'mysite']);

  // Serving + injection work for the new entry without a restart.
  const served = await call(f.sites, 'GET', '/sites/mysite/');
  assert.equal(served.res.statusCode, 200);
  assert.ok(served.res.text.includes("window.__pinpointEntry='mysite'"));

  // Bucket routing (entry gate) accepts the new entry.
  const save = await call(f.annotate, 'POST', '/save', JSON.stringify({
    entry: 'mysite', page: 'index', baseRevision: 0, annotations: [],
  }));
  assert.equal(save.res.statusCode, 200);
});

test('a broken rewrite surfaces on the reload response instead of crashing the service', async (t) => {
  const f = withFixture(t);
  writeRegistryFile(f.registryFile, { version: 1, entries: [{ id: 'mysite', kind: 'dir', path: f.site }] });
  await call(f.annotate, 'POST', '/registry/reload');
  assert.equal((await call(f.sites, 'GET', '/sites/mysite/')).res.statusCode, 200);

  fs.writeFileSync(f.registryFile, '{ broken');
  const reload = await call(f.annotate, 'POST', '/registry/reload');
  assert.equal(reload.res.statusCode, 200, 'reload itself stays a 200 with the failure in the payload');
  assert.equal(reload.res.json.ok, false);
  assert.match(reload.res.json.errors[0], /json/i);
  assert.equal((await call(f.sites, 'GET', '/sites/mysite/')).res.statusCode, 404, 'fallback snapshot has no mysite');
});

test('a static registry snapshot is not reloadable (409)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-reload-static-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const registry = loadRegistry({ path: path.join(dir, 'missing.json'), root: dir, log: () => {} });
  const handler = createAnnotateHandler({ dataRoot: path.join(dir, 'data'), registry });
  const { res } = await call(handler, 'POST', '/registry/reload');
  assert.equal(res.statusCode, 409);
  assert.equal(res.json.error, 'registry_not_reloadable');
});

test('/registry/reload does not swallow the save/image routing', async (t) => {
  const f = withFixture(t);
  // Unknown POST paths still fall through; GET on the reload route is a miss.
  assert.equal((await call(f.annotate, 'POST', '/nope')).handled, false);
  assert.equal((await call(f.annotate, 'GET', '/registry/reload')).handled, false);
});
