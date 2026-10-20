import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 所有外部命令经过同一口；测试用隔离磁盘与假命令确认构建失败不 checkout / restart。
export function promote({ root = ROOT, rev = 'main', release, home = os.homedir(), run = execFileSync, log = console.log } = {}) {
  const git = (args, cwd = root) => String(run('git', args, { cwd, encoding: 'utf8' })).trim();
  const main = path.dirname(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const rel = release || process.env.PINPOINT_RELEASE_DIR || path.join(main.replace('/repos/', '/repos/.worktrees/'), 'release');
  if (!fs.existsSync(rel)) throw new Error(`no release worktree at ${rel}`);
  if (git(['status', '--porcelain'], rel)) throw new Error(`${rel} is dirty; the release worktree only moves by promote`);
  if (git(['branch', '--show-current'], rel)) throw new Error(`${rel} is on a branch; portless would serve it on <branch>.pinpoint.localhost`);
  const target = git(['rev-parse', '--verify', `${rev}^{commit}`]);
  const prev = git(['rev-parse', 'HEAD'], rel);
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  const prepared = fs.mkdtempSync(path.join(root, '.tmp/promote-'));
  let moved = false;
  let depsMoved = false;
  let preservePrepared = false;
  const previousDeps = path.join(prepared, 'previous-node_modules');
  const dist = path.join(rel, '.tmp/workbench-dist');
  const priorShell = fs.existsSync(path.join(dist, 'index.html')) ? fs.readFileSync(path.join(dist, 'index.html')) : null;
  const priorEnabled = fs.existsSync(path.join(dist, 'enabled'));
  try {
    // 不先 checkout 活服务的目录：Vite 正在监听它，失败后再 checkout 回去已经太晚。
    const archive = path.join(prepared, 'source.tar');
    run('git', ['archive', '--format=tar', '--output', archive, target], { cwd: root });
    run('tar', ['-xf', archive, '-C', prepared], { cwd: root });
    const oldLock = fs.readFileSync(path.join(rel, 'package-lock.json'));
    const newLock = fs.readFileSync(path.join(prepared, 'package-lock.json'));
    const install = !oldLock.equals(newLock) || !fs.existsSync(path.join(rel, 'node_modules'));
    if (install) run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: prepared, stdio: 'inherit' });
    else fs.symlinkSync(path.join(rel, 'node_modules'), path.join(prepared, 'node_modules'), 'dir');
    const pkg = JSON.parse(fs.readFileSync(path.join(prepared, 'package.json'), 'utf8'));
    const bundled = Boolean(pkg.scripts?.['build:workbench']);
    if (bundled) {
      run('npm', ['run', 'build:workbench'], { cwd: prepared, stdio: 'inherit',
        env: { ...process.env, PINPOINT_WORKBENCH_DIST: path.join(prepared, '.tmp/workbench-dist') } });
      // 命令成功也必须真的有壳页和资源，才允许动正式 checkout。
      const built = path.join(prepared, '.tmp/workbench-dist');
      if (!fs.statSync(path.join(built, 'index.html')).isFile() || !fs.readdirSync(path.join(built, 'assets')).length) {
        throw new Error('工作台构建没有生成完整产物');
      }
    }
    git(['checkout', '-q', '--detach', target], rel);
    moved = true;
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
    run(process.execPath, [path.join(rel, 'bin/pinpoint.mjs'), 'restart'], { cwd: rel, stdio: 'inherit',
      env: { ...process.env, PINPOINT_WORKBENCH_MODE: bundled ? 'bundle' : 'dev', PINPOINT_WORKBENCH_DIST: dist } });
    fs.mkdirSync(path.join(home, '.pinpoint/logs'), { recursive: true });
    fs.appendFileSync(path.join(home, '.pinpoint/logs/releases.log'), `${new Date().toISOString()} ${prev} -> ${target}\n`);
    log(`promote: ${prev.slice(0, 7)} -> ${target.slice(0, 7)}; rollback: just promote ${prev.slice(0, 7)}`);
    return { prev, target };
  } catch (error) {
    if (moved) {
      // 重启失败时恢复磁盘提交和依赖，明确保留原错误；不声称服务已自动恢复健康。
      try {
        git(['checkout', '-q', '--detach', prev], rel);
        if (priorShell) fs.writeFileSync(path.join(dist, 'index.html'), priorShell);
        else fs.rmSync(path.join(dist, 'index.html'), { force: true });
        if (priorEnabled) fs.writeFileSync(path.join(dist, 'enabled'), '');
        else fs.rmSync(path.join(dist, 'enabled'), { force: true });
        if (depsMoved) {
          fs.rmSync(path.join(rel, 'node_modules'), { recursive: true, force: true });
          if (fs.existsSync(previousDeps)) fs.renameSync(previousDeps, path.join(rel, 'node_modules'));
        }
      } catch (rollbackError) {
        // 不清掉尚未恢复的旧依赖副本，给 owner 留恢复材料。
        preservePrepared = true;
        throw new AggregateError([error, rollbackError], `${error.message}；磁盘回滚失败：${rollbackError.message}；恢复材料保留在 ${prepared}`);
      }
    }
    throw error;
  } finally {
    if (!preservePrepared) fs.rmSync(prepared, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { promote({ rev: process.argv[2] || 'main' }); }
  catch (error) { console.error(`promote: ${error.message}`); process.exitCode = 1; }
}
