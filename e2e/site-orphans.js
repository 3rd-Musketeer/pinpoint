import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 上一轮 e2e 留下的文章站点（Astro dev）孤儿：还在本轮的站点端口上答，服务会把它当
// external 直接用（2026-10-13 实测）。只收拾同时满足三条的：监听 port；进程组 leader
// 的父进程是 1（拉起它的服务已经没了）；进程 cwd 在本仓（本 worktree）里。别的仓、
// owner 自己开着的站点都不碰。globalSetup 与 globalTeardown 都调。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function findSiteOrphans(port) {
  const orphans = [];
  for (const pid of run('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN']).split('\n').filter(Boolean).map(Number)) {
    const pgid = Number(run('ps', ['-o', 'pgid=', '-p', String(pid)]));
    const leaderParent = Number(run('ps', ['-o', 'ppid=', '-p', String(pgid)]));
    const cwd = (run('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find((line) => line.startsWith('n')) || '').slice(1);
    if (pgid > 1 && leaderParent === 1 && (cwd === ROOT || cwd.startsWith(ROOT + path.sep))) orphans.push({ pid, pgid, cwd });
  }
  return orphans;
}

export async function killSiteOrphans(port, log = (message) => console.warn(message)) {
  const orphans = findSiteOrphans(port);
  for (const { pid, pgid, cwd } of orphans) {
    log(`[e2e] 站点端口 ${port} 上有上一轮留下的孤儿（pid ${pid}，进程组 ${pgid}，cwd ${cwd}），停掉它`);
    try { process.kill(-pgid, 'SIGTERM'); } catch { /* gone */ }
    const deadline = Date.now() + 3000;
    while (alive(pid) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    if (alive(pid)) {
      try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
    }
  }
  return orphans.length;
}
