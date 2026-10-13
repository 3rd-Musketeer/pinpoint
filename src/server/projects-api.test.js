import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { listProjects } from './lib/projects.js';
import { loadRegistry } from './lib/registry.js';
import { createProjectsHandler } from './projects-api.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function serve(t, registry) {
  const handler = createProjectsHandler({ registry });
  const server = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 418; res.end(); }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('/api/projects returns listProjects output; /api/projects/<id> one project or 404', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-projects-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [
    { id: 'pinpoint', kind: 'dir', path: REPO },
    { id: 'e2e-project', kind: 'project', path: path.join(REPO, 'e2e', 'project-site') },
    { id: 'clash', kind: 'project', path: path.join(REPO, 'site', 'fixtures', 'projects', 'clash') },
  ] }));
  const registry = loadRegistry({ root: REPO, path: file, log: () => {} });
  const origin = await serve(t, registry);

  const all = await fetch(`${origin}/api/projects`);
  assert.equal(all.status, 200);
  assert.match(all.headers.get('content-type'), /application\/json/);
  assert.deepEqual(await all.json(), listProjects(registry));

  const one = await (await fetch(`${origin}/api/projects/e2e-project`)).json();
  assert.deepEqual(one.articles.map((a) => a.id), ['commit-confirm', 'takeover']);
  assert.deepEqual(one.errors, []);
  const collide = await (await fetch(`${origin}/api/projects/clash/`)).json();
  assert.equal(collide.errors.length, 1, 'layout errors are data, the request still succeeds');

  assert.equal((await fetch(`${origin}/api/projects/nope`)).status, 404);
  assert.equal((await fetch(`${origin}/api/projects`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/api/projectsx`)).status, 418, 'other paths fall through');
});
