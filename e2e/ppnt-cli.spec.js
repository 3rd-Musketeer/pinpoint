import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { test } from '@playwright/test';

import { E2E_BASE_URL, E2E_DATA_DIR, E2E_REGISTRY } from './env.js';

// ppnt CLI 四命令的端到端（切片 4）：不开浏览器工具做验证，全部走 CLI 子进程。
// 链路：seed 账本 → check --mode both（markdown + 服务渲染的 1x 截图）→
// mark done（真端点，带 baseRevision）→ status --page（计数移动 + dist 状态）。
const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(E2E_DATA_DIR, 'pinpoint', 'ppnt-cli.json');
// home.jsx 的真实产物链：segmented 的「日」按钮（button.on 是 classList[0] 形态）。
const DAY_BUTTON = 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > div.ios-page:nth-of-type(1) > div.ios-segmented:nth-of-type(1) > button.on:nth-of-type(1)';
const TITLE = 'div.ios-stage:nth-of-type(1) > div.ios-app:nth-of-type(1) > div.ios-nav:nth-of-type(1) > h1:nth-of-type(1)';

function seedLedger() {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
  fs.writeFileSync(LEDGER, JSON.stringify({
    page: 'ppnt-cli',
    path: '/index.html',
    revision: 1,
    annotations: [
      {
        id: 'cli-1', n: 1, type: 'element', pageId: 'e2e-ios', screenId: 'home', status: 'open',
        content: '标题「冲煮手账」改成「冲煮日志」 [@t:i1]',
        targets: [{ ref: 'i1', selector: TITLE, text: '冲煮手账' }],
      },
      {
        id: 'cli-2', n: 2, type: 'element', pageId: 'e2e-ios', screenId: 'home', status: 'open',
        changeTo: '日 → 今日',
        content: '分段控件的「日」写全成「今日」 [@t:i1]',
        targets: [{ ref: 'i1', selector: DAY_BUTTON, text: '日' }],
      },
    ],
  }));
}

async function ppnt(args, { expectFail = false } = {}) {
  try {
    // process.execPath：playwright worker 的 PATH 不一定带 node。
    const { stdout, stderr } = await execFileP(process.execPath, [path.join(ROOT, 'bin', 'pinpoint.mjs'), ...args], {
      cwd: ROOT,
      env: {
        ...process.env,
        PINPOINT_DATA_DIR: E2E_DATA_DIR,
        PINPOINT_REGISTRY: E2E_REGISTRY,
        PINPOINT_ORIGIN: E2E_BASE_URL,
      },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    if (!expectFail) throw error;
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test.afterEach(() => {
  // seedLedger 播的账本自己收走：bucket pinpoint 是与 spa-ledger 等 spec 共享的，
  // 残留会把别人「恰好这些账本」的断言数多一个（实测复现过）。
  fs.rmSync(LEDGER, { force: true });
});

test('ppnt check --mode both → mark done → status --page 全链（CLI 子进程）', async ({ request }) => {
  seedLedger();
  // globalSetup 在服务启动编译之后清空数据根（账本重置），dist 被一并抹掉、
  // 由首次访问懒编译补回：先用一次 GET 把 e2e-ios 编译回盘，CLI 的只读面
  // （check 摘录 / status --page）才有 dist 可读。
  const warm = await request.get('/sites/e2e-ios/home.html');
  if (warm.status() !== 200) throw new Error(`暖编译失败：${warm.status()} ${await warm.text()}`);
  const homeDist = path.join(E2E_DATA_DIR, 'dist', 'e2e-ios', 'home.html');
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(homeDist)) {
    if (Date.now() > deadline) throw new Error(`懒编译 20s 内没落 dist：${homeDist}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  // 1. check --mode both：markdown 清单 + 源码摘录 + 服务渲染的 1x 截图。
  const check = await ppnt(['check', 'e2e-ios', '--mode', 'both', '--status', 'open']);
  const shotPath = path.join(E2E_DATA_DIR, 'check', 'e2e-ios', 'home.png');
  if (check.code !== 0) throw new Error(`check 退出 ${check.code}：${check.stderr}`);
  const lines = check.stdout.split('\n');
  const row1 = lines.find((line) => line.includes('[#1]'));
  if (!row1) throw new Error(`清单缺 #1：\n${check.stdout}`);
  if (!row1.includes('冲煮日志') || !row1.includes('open')) throw new Error(`#1 行不完整：${row1}`);
  const row2 = lines.find((line) => line.includes('[#2]'));
  if (!row2 || !row2.includes('changeTo')) throw new Error(`#2 意图字段缺失：${row2}`);
  if (!lines.some((line) => />.*冲煮手账/.test(line))) throw new Error(`#1 的源码摘录缺锚点行：\n${check.stdout}`);
  if (!lines.some((line) => line.includes(shotPath))) throw new Error(`markdown 没给截图路径：\n${check.stdout}`);
  const png = fs.readFileSync(shotPath);
  if (png.length < 2000 || png[0] !== 0x89 || png[1] !== 0x50) throw new Error(`截图不像 PNG：${png.length} 字节`);

  // 2. locate：#1 给源文件:行。
  const locate = await ppnt(['locate', '#1', '--page', 'e2e-ios']);
  if (!locate.stdout.includes('#1 → home.jsx:')) throw new Error(`locate 输出不对：\n${locate.stdout}`);

  // 3. mark（真端点 + baseRevision）；done → done 的非法转换打 409 原因不中断。
  const mark = await ppnt(['mark', '#2', 'check', '--note', '看了，改不了', '--page', 'e2e-ios']);
  if (!mark.stdout.includes('#2 → check（note：看了，改不了）')) throw new Error(`mark 输出不对：\n${mark.stdout}`);
  const done = await ppnt(['mark', '#2', 'done', '--page', 'e2e-ios']);
  if (!done.stdout.includes('#2 → done')) throw new Error(`done 输出不对：\n${done.stdout}`);
  const again = await ppnt(['mark', '#2', 'done', '--page', 'e2e-ios'], { expectFail: true });
  if (!again.stdout.includes('409') || !again.stdout.includes('illegal_transition')) {
    throw new Error(`done → done 应打 409 原因：\n${again.stdout}`);
  }
  const close = await ppnt(['mark', '#2', 'close', '--page', 'e2e-ios'], { expectFail: true });
  if (!close.stderr.includes('close 只在工作台')) throw new Error(`close 应拒收：\n${close.stderr}`);

  // 4. status --page：计数移动到位，dist 最新。
  const status = await ppnt(['status', '--page', 'e2e-ios']);
  if (!status.stdout.includes('open 1 · check 0 · done 1 · close 0 · 共 2')) {
    throw new Error(`状态计数不对：\n${status.stdout}`);
  }
  if (!status.stdout.includes('最新')) throw new Error(`dist 应为最新：\n${status.stdout}`);

  // 5. shot --marks：帧图带序号钉，落在 <dataRoot>/shot/ 下。
  const shot = await ppnt(['shot', 'A1', '--marks', '--page', 'e2e-ios']);
  const framePng = path.join(E2E_DATA_DIR, 'shot', 'e2e-ios', 'A1.png');
  if (!shot.stdout.includes(framePng)) throw new Error(`shot 没打路径：\n${shot.stdout}`);
  if (!fs.existsSync(framePng) || fs.readFileSync(framePng).length < 2000) throw new Error('帧图没落盘');

  // 6. shot <页>：页引用不必是基页（缺省基页 = registry 第一页，不是 example）
  // —— 整页一张拼图，落在 <dataRoot>/shot/<页>/<页>.png。
  const pageShot = await ppnt(['shot', 'example']);
  const pagePng = path.join(E2E_DATA_DIR, 'shot', 'example', 'example.png');
  if (pageShot.code !== 0) throw new Error(`shot <页> 退出 ${pageShot.code}：${pageShot.stderr}`);
  if (!pageShot.stdout.includes(pagePng)) throw new Error(`shot <页> 没打路径：\n${pageShot.stdout}`);
  if (!fs.existsSync(pagePng) || fs.readFileSync(pagePng).length < 2000) throw new Error('整页图没落盘');
});
