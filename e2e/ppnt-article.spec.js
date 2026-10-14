import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY, E2E_SITES_DIR } from './env.js';

// ppnt 说文章模型（pp3）：文章页截图要真站点（Astro 开发服务器，服务按需拉起）和真浏览器，
// check 的正文渲染检查要和站点对同一份正文给出同一个结论。全部走 CLI 子进程。
// 站点：在 e2e-parallel 的 SITE_SPECS 里，和别的拉起站点的 spec 同组；单独跑这一个文件时站点是冷的，
// shot 自己等过“站点启动中”（503）。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLE = 'e2e-project/commit-confirm';
const SHOT_DIR = path.join(E2E_DATA_DIR, 'shot', 'e2e-project_commit-confirm');
const BROKEN_ID = 'e2e-ppnt-broken';
const BROKEN_ROOT = path.join(E2E_SITES_DIR, 'ppnt-broken');

async function ppnt(args) {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
      cwd: ROOT,
      env: { ...process.env, PINPOINT_DATA_DIR: E2E_DATA_DIR, PINPOINT_REGISTRY: E2E_REGISTRY, PINPOINT_ORIGIN: E2E_BASE_URL },
      timeout: 150_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

function pngSize(file) {
  const buffer = fs.readFileSync(file);
  expect(buffer.subarray(1, 4).toString()).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test.afterEach(async () => {
  // 登记的坏 project 一定撤掉：同组后面的 spec 会数工作台左栏的文章。
  const registry = JSON.parse(fs.readFileSync(E2E_REGISTRY, 'utf8'));
  if (registry.entries.some((entry) => entry.id === BROKEN_ID)) await ppnt(['remove', BROKEN_ID]);
  fs.rmSync(BROKEN_ROOT, { recursive: true, force: true });
});

test('ppnt shot <project>/<article>：等站点就绪后截文章页整页、§2 那一节；编号照旧截画布', async () => {
  test.setTimeout(240_000);
  fs.rmSync(SHOT_DIR, { recursive: true, force: true });

  await test.step('不写引用：文章页整页（比一屏高），打印斜杠地址', async () => {
    const res = await ppnt(['shot', ARTICLE, '--timeout', '150']);
    expect(res.code, res.stderr).toBe(0);
    const out = path.join(SHOT_DIR, 'article.png');
    expect(res.stdout.trim()).toMatch(new RegExp(`^${ARTICLE} 文章页 → ${out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · 1440×\\d+$`));
    const size = pngSize(out);
    expect(size.width).toBe(1440);
    expect(size.height).toBeGreaterThan(900);
  });

  await test.step('§2：文章页上的第 2 节（confirm），比整页矮', async () => {
    const res = await ppnt(['shot', ARTICLE, '§2']);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('B（§2 confirm）文章页 → ');
    const size = pngSize(path.join(SHOT_DIR, 'article-confirm.png'));
    expect(size.height).toBeLessThan(pngSize(path.join(SHOT_DIR, 'article.png')).height);
    expect(size.width).toBeGreaterThan(300);
  });

  await test.step('B1 和 C：画布视图上的帧和节（同一条命令里文章页和画布都能截）', async () => {
    const res = await ppnt(['shot', ARTICLE, 'B1', 'C']);
    expect(res.code, res.stderr).toBe(0);
    expect(res.stdout).toContain('B1 · confirm-sheet → ');
    expect(res.stdout).toContain('C（§3 variants） → ');
    expect(fs.existsSync(path.join(SHOT_DIR, 'confirm-sheet.png'))).toBe(true);
    expect(fs.existsSync(path.join(SHOT_DIR, 'variants.png'))).toBe(true);
  });
});

test('ppnt check 抓到正文渲染错误（<Foo />），站点渲染同一篇时没有正文；修好后两边都过', async ({ request }) => {
  test.setTimeout(240_000);
  fs.cpSync(path.join(ROOT, 'e2e', 'project-site'), BROKEN_ROOT, { recursive: true });
  const content = path.join(BROKEN_ROOT, 'docs', 'pinpoint');
  fs.writeFileSync(path.join(content, 'project.json'), JSON.stringify({ id: BROKEN_ID, title: 'ppnt 坏正文' }));
  const index = path.join(content, 'articles', 'commit-confirm', 'index.mdx');
  const good = fs.readFileSync(index, 'utf8');
  const body = good.replace(/\n*$/, '\n');
  // body 的最后一行之后空一行，再写 <Foo />。
  const fooLine = body.split('\n').length + 1;
  fs.writeFileSync(index, `${body}\n<Foo />\n`);
  const added = await ppnt(['add', BROKEN_ROOT, '--project']);
  expect(added.code, added.stderr).toBe(0);

  await test.step('check：exit 1，mdx_component_missing 指到 index.mdx 的那一行', async () => {
    const res = await ppnt(['check', `${BROKEN_ID}/commit-confirm`, '--json']);
    expect(res.code, res.stderr).toBe(1);
    const report = JSON.parse(res.stdout);
    const errors = report.diagnostics.filter((row) => row.severity === 'error');
    expect(errors.map((row) => [row.code, row.file, row.line])).toEqual([['mdx_component_missing', index, fooLine]]);
  });

  /** 文章页的状态码：站点在启动就等（503）。 */
  const articleStatus = async () => {
    const deadline = Date.now() + 150_000;
    for (;;) {
      const res = await request.get(`/${BROKEN_ID}/commit-confirm/`);
      if (res.status() !== 503 && res.status() !== 404) return { status: res.status(), text: await res.text() };
      if (Date.now() > deadline) throw new Error(`文章页一直 ${res.status()}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  // Astro 开发服务器边渲染边发：多数时候状态码 200 早就发出去了，渲染到 <Foo /> 抛错，响应停在正文开头；
  // 少数时候错误抛在发头之前，是 500。两种都没有正文，只看状态码看不出前一种。
  const BODY_TEXT = '确认卡列出要提交的内容';
  await test.step('站点渲染同一篇：没有正文（500，或 200 但停在正文开头）', async () => {
    const page = await articleStatus();
    expect([200, 500]).toContain(page.status);
    expect(page.text).not.toContain(BODY_TEXT);
    if (page.status === 200) {
      expect(page.text).toContain('<div class="article-body">');
      expect(page.text).not.toContain('</main>');
    }
  });

  await test.step('修好：check 退 0，站点渲染出整篇', async () => {
    fs.writeFileSync(index, good);
    const res = await ppnt(['check', `${BROKEN_ID}/commit-confirm`]);
    expect(res.code, res.stdout + res.stderr).toBe(0);
    await expect.poll(async () => (await articleStatus()).text.includes(BODY_TEXT), { timeout: 30_000 }).toBe(true);
  });
});
