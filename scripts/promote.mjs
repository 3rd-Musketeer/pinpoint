import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 所有外部命令经过同一口；测试用隔离磁盘与假命令确认构建失败不 checkout / restart。
export async function promote(options = {}) {
  let interrupted, active, escalation;
  let recovering = false;
  // detached 子命令实测可能并未自成进程组，kill(-pid) 会是空枪；先探测组，打不中就直接打进程本身。
  const signalCommand = (pid, signal) => {
    let grouped;
    try { process.kill(-pid, 0); grouped = true; } catch { grouped = false; }
    try { process.kill(grouped ? -pid : pid, signal); } catch { /* 命令已退出 */ }
  };
  const onSignal = signal => {
    if (recovering || interrupted) return; // 收尾不能被第二次 Ctrl-C 再次打断；恢复命令被打死由 run 的有界重试兜住。
    interrupted = new Error(`收到 ${signal}，发布已中止`);
    if (active) {
      const pid = active.pid;
      signalCommand(pid, signal);
      escalation = setTimeout(() => signalCommand(pid, 'SIGKILL'), 2000);
    }
  };
  const handlers = ['SIGINT', 'SIGTERM'].map(signal => {
    const handler = () => onSignal(signal);
    process.on(signal, handler);
    return [signal, handler];
  });
  const run = async (cmd, args, commandOptions) => {
    if (interrupted && !recovering) throw interrupted;
    try {
      // 恢复序列里的命令可能被收尾期间连按的组信号直接打死；等子进程退出后有界重试（至多 3 次），
      // 重试耗尽才走保留恢复材料并打印恢复命令的路径。
      for (let attempt = 1; ; attempt++) {
        try {
          const result = options.run ? await options.run(cmd, args, commandOptions) : await new Promise((resolve, reject) => {
            // 信号只经 onSignal 转发给这条命令及其 npm 子进程；恢复命令另起。
            active = execFile(cmd, args, { ...commandOptions, encoding: 'utf8', detached: true },
              (error, stdout) => error ? reject(error) : resolve(stdout));
          });
          if (interrupted && !recovering) throw interrupted;
          return result;
        } catch (error) {
          if (!(recovering && error?.signal && attempt < 3)) throw interrupted && !recovering ? interrupted : error;
        }
      }
    } finally { active = null; clearTimeout(escalation); }
  };
  try { return await promoteTransaction({ ...options, run, recover: () => { recovering = true; } }); }
  finally { for (const [signal, handler] of handlers) process.off(signal, handler); }
}

async function promoteTransaction({ root = ROOT, rev = 'main', release, home = os.homedir(), run, recover, log = console.log, warn = console.error }) {
  const git = async (args, cwd = root) => String(await run('git', args, { cwd, encoding: 'utf8' })).trim();
  const main = path.dirname(await git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const requested = release || process.env.PINPOINT_RELEASE_DIR || path.join(main.replace('/repos/', '/repos/.worktrees/'), 'release');
  if (!fs.existsSync(requested)) throw new Error(`no release worktree at ${requested}`);
  const rel = fs.realpathSync(requested);
  fs.mkdirSync(path.join(rel, '.tmp'), { recursive: true });
  const lock = path.join(rel, '.tmp/promote.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let owner = '持有者信息尚未写入';
    try { owner = fs.readFileSync(lock, 'utf8'); } catch { /* 对方仍占有锁或刚刚退出，不抢锁 */ }
    throw new Error(`发布锁 ${lock} 已被持有：${owner}；本次立即退出，不排队。若进程已退出，请先核查服务及恢复材料，再手动移除该锁。`);
  }
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, host: os.hostname(), started: new Date().toISOString(), release: rel, root, rev }));
    // prev、旧壳与依赖状态必须在拿锁之后重新读取，锁一直覆盖健康检查、回滚及日志。
    return await publishLocked({ root, rev, rel, home, run, recover, log, warn });
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}

async function publishLocked({ root, rev, rel, home, run, recover, log, warn }) {
  const git = async (args, cwd = root) => String(await run('git', args, { cwd, encoding: 'utf8' })).trim();
  if (await git(['status', '--porcelain'], rel)) throw new Error(`${rel} is dirty; the release worktree only moves by promote`);
  if (await git(['branch', '--show-current'], rel)) throw new Error(`${rel} is on a branch; portless would serve it on <branch>.pinpoint.localhost`);
  const target = await git(['rev-parse', '--verify', `${rev}^{commit}`]);
  const prev = await git(['rev-parse', 'HEAD'], rel);
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const prepared = fs.mkdtempSync(path.join(root, '.tmp/promote-'));
  let moved = false;
  let serviceTouched = false;
  let depsMoved = false;
  let preservePrepared = false;
  const previousDeps = path.join(prepared, 'previous-node_modules');
  const dist = path.join(rel, '.tmp/workbench-dist');
  const priorShell = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html')) : null;
  const priorEnabled = fs.existsSync(path.join(dist, 'enabled'));
  const cli = path.join(rel, 'bin/pinpoint.mjs');
  const oldEnv = { ...process.env, PINPOINT_WORKBENCH_MODE: priorEnabled ? 'bundle' : 'dev', PINPOINT_WORKBENCH_DIST: dist };
  const service = (action, env) => run(process.execPath, [cli, action], { cwd: rel, stdio: 'inherit', env });
  const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;
  // 恢复材料必须落盘，不能只存在本进程的 Buffer 里。
  if (priorShell) fs.writeFileSync(path.join(prepared, 'previous-index.html'), priorShell);
  const recovery = path.join(prepared, 'recovery.sh');
  fs.writeFileSync(recovery, [
    '#!/bin/sh', 'set -eu', `cd ${quote(rel)}`, `node ${quote(cli)} stop`,
    `git checkout -q --detach ${quote(prev)}`, `mkdir -p ${quote(dist)}`,
    priorShell ? `cp ${quote(path.join(prepared, 'previous-index.html'))} ${quote(path.join(dist, 'index.html'))}` : `rm -f ${quote(path.join(dist, 'index.html'))}`,
    priorEnabled ? `touch ${quote(path.join(dist, 'enabled'))}` : `rm -f ${quote(path.join(dist, 'enabled'))}`,
    `if [ -e ${quote(previousDeps)} ]; then rm -rf ${quote(path.join(rel, 'node_modules'))}; mv ${quote(previousDeps)} ${quote(path.join(rel, 'node_modules'))}; fi`,
    `export PINPOINT_WORKBENCH_MODE=${quote(oldEnv.PINPOINT_WORKBENCH_MODE)} PINPOINT_WORKBENCH_DIST=${quote(dist)}`,
    `node ${quote(cli)} start`, `node ${quote(cli)} status`, '',
  ].join('\n'), { mode: 0o700 });
  fs.writeFileSync(path.join(prepared, 'recovery.json'), JSON.stringify({ rel, prev, target, priorEnabled, priorShell: Boolean(priorShell) }, null, 2));
  try {
    // 不先 checkout 活服务的目录：Vite 正在监听它，失败后再 checkout 回去已经太晚。
    const archive = path.join(prepared, 'source.tar');
    await run('git', ['archive', '--format=tar', '--output', archive, target], { cwd: root });
    await run('tar', ['-xf', archive, '-C', prepared], { cwd: root });
    const oldLock = fs.readFileSync(path.join(rel, 'package-lock.json'));
    const newLock = fs.readFileSync(path.join(prepared, 'package-lock.json'));
    const install = !oldLock.equals(newLock) || !fs.existsSync(path.join(rel, 'node_modules'));
    if (install) await run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: prepared, stdio: 'inherit' });
    else fs.symlinkSync(path.join(rel, 'node_modules'), path.join(prepared, 'node_modules'), 'dir');
    const pkg = JSON.parse(fs.readFileSync(path.join(prepared, 'package.json'), 'utf8'));
    const bundled = Boolean(pkg.scripts?.['build:workbench']);
    if (bundled) {
      await run('npm', ['run', 'build:workbench'], { cwd: prepared, stdio: 'inherit',
        env: { ...process.env, PINPOINT_WORKBENCH_DIST: path.join(prepared, '.tmp/workbench-dist') } });
      // 命令成功也必须真的有壳页和资源，才允许动正式 checkout。
      const built = path.join(prepared, '.tmp/workbench-dist');
      if (!fs.statSync(path.join(built, 'index.html')).isFile() || !fs.readdirSync(path.join(built, 'assets')).length) {
        throw new Error('工作台构建没有生成完整产物');
      }
    }
    // 构建成功后才停旧；从第一次 stop 起，任何失败都必须恢复运行中的旧服务。
    serviceTouched = true;
    await service('stop', oldEnv);
    moved = true;
    await git(['checkout', '-q', '--detach', target], rel);
    if (install) {
      if (fs.existsSync(path.join(rel, 'node_modules'))) fs.renameSync(path.join(rel, 'node_modules'), previousDeps);
      depsMoved = true;
      fs.renameSync(path.join(prepared, 'node_modules'), path.join(rel, 'node_modules'));
    }
    fs.mkdirSync(dist, { recursive: true });
    if (bundled) {
      const built = path.join(prepared, '.tmp/workbench-dist');
      fs.cpSync(path.join(built, 'assets'), path.join(dist, 'assets'), { recursive: true });
      // 壳页原子替换；旧服务启动时已固定旧壳，旧 hash 资源保留。
      fs.renameSync(path.join(built, 'index.html'), path.join(dist, 'index.html'));
      fs.writeFileSync(path.join(dist, 'enabled'), '');
    } else {
      // 允许回滚到引入打包机制之前的提交。
      fs.rmSync(path.join(dist, 'enabled'), { force: true });
    }
    const newEnv = { ...oldEnv, PINPOINT_WORKBENCH_MODE: bundled ? 'bundle' : 'dev' };
    await service('start', newEnv);
    await service('status', newEnv);
  } catch (error) {
    recover();
    if (serviceTouched) {
      try {
        // start 可能已经起了进程再返回失败；先停它，才允许恢复磁盘。
        await service('stop', oldEnv);
        if (moved) await git(['checkout', '-q', '--detach', prev], rel);
        fs.mkdirSync(dist, { recursive: true });
        if (priorShell) fs.writeFileSync(path.join(dist, 'index.html'), priorShell);
        else fs.rmSync(path.join(dist, 'index.html'), { force: true });
        if (priorEnabled) fs.writeFileSync(path.join(dist, 'enabled'), '');
        else fs.rmSync(path.join(dist, 'enabled'), { force: true });
        if (depsMoved) {
          fs.rmSync(path.join(rel, 'node_modules'), { recursive: true, force: true });
          if (fs.existsSync(previousDeps)) fs.renameSync(previousDeps, path.join(rel, 'node_modules'));
        }
        await service('start', oldEnv);
        await service('status', oldEnv);
        warn('promote: 旧服务已恢复并验证健康');
      } catch (rollbackError) {
        // 不清掉尚未恢复的旧依赖副本，给 owner 留恢复材料。
        preservePrepared = true;
        // 恢复启动也可能留下不健康的旧进程；尽力停止，恢复脚本还会再次检查 stop。
        try { await service('stop', oldEnv); } catch { /* 不掩盖恢复失败，材料与命令保留 */ }
        throw new AggregateError([error, rollbackError], `${error.message}；旧服务恢复失败：${rollbackError.message}；恢复材料保留在 ${prepared}；恢复命令：sh ${quote(recovery)}`);
      }
    }
    throw error;
  } finally {
    if (!preservePrepared) fs.rmSync(prepared, { recursive: true, force: true });
  }
  // 此时新服务已验证健康。日志是发布记录，写失败只报警，不能回滚运行中服务。
  try {
    fs.mkdirSync(path.join(home, '.pinpoint/logs'), { recursive: true });
    fs.appendFileSync(path.join(home, '.pinpoint/logs/releases.log'), `${new Date().toISOString()} ${prev} -> ${target}\n`);
  } catch (error) { warn(`promote: 新服务已健康，发布日志写入失败：${error.message}；当前 ${target}，回滚命令：just promote ${prev}`); }
  log(`promote: ${prev.slice(0, 7)} -> ${target.slice(0, 7)}; rollback: just promote ${prev.slice(0, 7)}`);
  return { prev, target };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await promote({ rev: process.argv[2] || 'main' }); }
  catch (error) { console.error(`promote: ${error.message}`); process.exitCode = 1; }
}
