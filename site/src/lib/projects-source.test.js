import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listProjectsStub, loadProjects, registryPath } from './projects-source.js';

const FIX = fileURLToPath(new URL('../../fixtures/projects/', import.meta.url));

test('stub listProjects returns the common.md §3 shape for registered projects', () => {
  const projects = listProjectsStub({ entries: [
    { id: 'demo', kind: 'project', path: path.join(FIX, 'demo') },
    { id: 'site', kind: 'dir', path: '/elsewhere' },
  ] });
  assert.equal(projects.length, 1);
  const [p] = projects;
  assert.deepEqual([p.id, p.title, p.root, p.dir], ['demo', 'Demo 项目', path.join(FIX, 'demo'), path.join(FIX, 'demo', 'docs', 'pinpoint')]);
  assert.deepEqual(p.articles.map((a) => [a.id, a.title]), [['basics', '基础篇'], ['payments', '浏览器任务里的付款']]);
  assert.equal(p.articles[1].file, path.join(p.dir, 'articles', 'payments', 'index.mdx'));
  assert.deepEqual(p.concepts.map((c) => c.name), ['确认卡']);
});

test('registry path follows PINPOINT_REGISTRY, and a missing registry means no projects', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-site-reg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'registry.json');
  assert.equal(registryPath({ PINPOINT_REGISTRY: file }), file);
  assert.match(registryPath({}), /\.pinpoint[\\/]registry\.json$/);
  const none = await loadProjects({ PINPOINT_REGISTRY: file });
  assert.deepEqual([none.projects, none.errors], [[], []]);
  fs.writeFileSync(file, JSON.stringify({ version: 1, entries: [{ id: 'other', kind: 'project', path: path.join(FIX, 'other') }] }));
  const one = await loadProjects({ PINPOINT_REGISTRY: file });
  assert.deepEqual(one.projects.map((p) => p.id), ['other']);
});
