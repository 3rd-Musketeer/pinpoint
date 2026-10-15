import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { E2E_SITES_DIR } from './env.js';
import { ROOT, ppntResult } from './lib/cli.js';
import { appendRegistryEntry, restoreRegistryFixture } from './registry-fixture.js';

// pp3：`ppnt migrate` 把模板页 example 迁进一个 project（e2e/project-site 的本轮副本，
// project id 改成 e2e-migrate），服务不重启就能经 /api/frame 打开迁过来的帧。
// 不经过 Astro：只验画布这一侧（正文渲染由 test:site 管）。
const PROJECT_DIR = path.join(E2E_SITES_DIR, 'migrate-site');
const PAGE_ID = 'e2e-migrate_example';

/** 失败时 stderr 并进 stdout：断言只看 stdout 一处。 */
async function ppnt(args) {
  const res = await ppntResult(args);
  return res.code === 0 ? { code: 0, stdout: res.stdout } : { code: res.code, stdout: `${res.stdout}\n${res.stderr}` };
}

test.afterEach(async ({ request }) => {
  await restoreRegistryFixture(request);
  fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
});

test('ppnt migrate：模板页迁成文章，/api/frame 打开迁过来的帧', async ({ request }) => {
  fs.rmSync(PROJECT_DIR, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'e2e', 'project-site'), PROJECT_DIR, { recursive: true });
  fs.writeFileSync(path.join(PROJECT_DIR, 'docs', 'pinpoint', 'project.json'), JSON.stringify({ id: 'e2e-migrate', title: 'E2E Migrate' }));
  appendRegistryEntry({ id: 'e2e-migrate', kind: 'project', path: PROJECT_DIR });
  expect((await request.post('/registry/reload')).ok()).toBe(true);
  const template = path.join(ROOT, 'content', 'previews', 'example');
  const before = fs.readdirSync(template).sort();

  await test.step('migrate：写文章、逐帧校验通过、说明标注留在旧页', async () => {
    const run = await ppnt(['migrate', 'example', '--project', PROJECT_DIR]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.stdout).toContain('通过：9 帧都编过');
    expect(run.stdout).toContain('旧页的标注留在旧页（桶 example）');
    expect(run.stdout).toContain(`画布 /workbench/?page=${PAGE_ID}`);
    expect(fs.readdirSync(template).sort()).toEqual(before);
    // 再跑一次：目录已在，拒绝。
    const again = await ppnt(['migrate', 'example', '--project', PROJECT_DIR]);
    expect(again.code).toBe(1);
    expect(again.stdout).toContain('文章目录已存在');
  });

  await test.step('服务：画布结构、comp 帧进组件台、手机帧带 article.css、sidecar 可取', async () => {
    const canvas = await (await request.get('/api/projects/e2e-migrate/articles/example/canvas')).json();
    expect(canvas.errors).toEqual([]);
    expect(canvas.sections.map((s) => [s.id, s.letter, s.shell || '', s.frames.map((f) => f.id)])).toEqual([
      ['brew', 'A', '', ['beans', 'recipe', 'timer']],
      ['bean-card', 'B', 'comp', ['card-idle', 'card-selected', 'card-empty']],
      ['step-row', 'C', 'comp', ['step-todo', 'step-now', 'step-done']],
    ]);
    const card = await request.get(`/api/frame?page=${PAGE_ID}&screen=card-selected&annotate=off`);
    expect(card.status()).toBe(200);
    const cardHtml = await card.text();
    expect(cardHtml).toMatch(/class="wb-comp-stage[ "]/);
    expect(cardHtml).toContain('哥伦比亚 慧兰');
    expect(cardHtml).toContain('data-pp-comp="BeanCard"');
    const timer = await (await request.get(`/api/frame?page=${PAGE_ID}&screen=timer&annotate=off`)).text();
    expect(timer).toMatch(/class="ios-stage[ "]/);
    expect(timer).toContain(`@import url("/sites/${PAGE_ID}/article.css")`);
    expect((await request.get(`/sites/${PAGE_ID}/article.css`)).status()).toBe(200);
    expect((await request.get(`/sites/${PAGE_ID}/timer.js`)).status()).toBe(200);
  });
});
