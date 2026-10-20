import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { promote } from './promote.mjs';

// 来自 review 的 promote-lifecycle.mjs：Git、npm 与 HTTP 服务都是真的，只有 CLI 是隔离固件。
// 不能只断言 checkout：失败后必须观察到旧 HTTP 进程重新健康，而非“新进程 + 旧磁盘”。
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinpoint-promote-life-'));
  const root = path.join(dir, 'repo');
  fs.mkdirSync(root);
  const port = await new Promise(resolve => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
  const run = (cmd, args, cwd = root, env = process.env) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const git = (...args) => run('git', args);
  const write = (name, text) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  git('init', '-q'); git('config', 'user.name', 'Lifecycle Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('.gitignore', 'node_modules/\n.tmp/\n');
  write('package.json', JSON.stringify({ name: 'promote-fixture', version: '1.0.0', type: 'module', scripts: { 'build:workbench': 'node build.mjs' } }));
  write('package-lock.json', JSON.stringify({ name: 'promote-fixture', version: '1.0.0', lockfileVersion: 3, packages: { '': { name: 'promote-fixture', version: '1.0.0' } } }));
  write('build.mjs', `import fs from 'node:fs';import path from 'node:path';
if(process.env.FAIL_PHASE==='build')process.exit(7);
if(process.env.GATE_PHASE==='build'){fs.writeFileSync(process.env.FAKE_GATE+'.entered','');while(!fs.existsSync(process.env.FAKE_GATE+'.release'))await new Promise(r=>setTimeout(r,20));}
const d=process.env.PINPOINT_WORKBENCH_DIST;fs.mkdirSync(path.join(d,'assets'),{recursive:true});
fs.writeFileSync(path.join(d,'index.html'),'new-shell');fs.writeFileSync(path.join(d,'assets/new-abc123.js'),'new-asset');`);
  write('version.txt', 'old');
  write('service.mjs', `import fs from 'node:fs';import http from 'node:http';
const version=fs.readFileSync(new URL('./version.txt',import.meta.url),'utf8');
const deps=fs.existsSync(new URL('./node_modules/old-dep',import.meta.url))?'old':'new';
const shell=fs.readFileSync(new URL('./.tmp/workbench-dist/index.html',import.meta.url),'utf8');
const server=http.createServer((q,s)=>s.end(JSON.stringify({version,deps,shell})));
server.listen(Number(process.env.FAKE_PORT),'127.0.0.1',()=>fs.writeFileSync(process.env.FAKE_STATE,String(process.pid)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`);
  write('bin/pinpoint.mjs', `import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
const state=process.env.FAKE_STATE,phase=process.env.FAIL_PHASE;
const version=fs.readFileSync('version.txt','utf8');const target=version==='new';
const pause=()=>new Promise(r=>setTimeout(r,20));
fs.appendFileSync(process.env.FAKE_STATE+'.actions',process.argv[2]+':'+version+'\\n');
async function gate(phase){if(process.env.GATE_PHASE!==phase||fs.existsSync(process.env.FAKE_GATE+'.entered'))return;fs.writeFileSync(process.env.FAKE_GATE+'.entered','');while(!fs.existsSync(process.env.FAKE_GATE+'.release'))await pause();}
async function hold(marker){fs.writeFileSync(marker+'.pid',String(process.pid));fs.writeFileSync(marker,'');while(!fs.existsSync(marker+'.release'))await pause();}
async function probe(){try{const r=await fetch('http://127.0.0.1:'+process.env.FAKE_PORT,{signal:AbortSignal.timeout(500)});return r.ok?await r.json():null;}catch{return null;}}
async function stop(){if(fs.existsSync(state)){try{process.kill(Number(fs.readFileSync(state,'utf8')),'SIGTERM');}catch{}fs.rmSync(state,{force:true});}for(let n=0;n<100&&await probe();n++)await pause();if(await probe())process.exit(12);}
async function start(){
if(target&&phase==='interrupt2')await hold(process.env.FAKE_GATE+'.target');
if(!target&&phase==='interrupt2')await hold(process.env.FAKE_GATE+'.restore');
if(target)await gate('before-start');
if(target&&phase==='restart-before-start')process.exit(9);
if(!target&&phase==='restore-start')process.exit(13);
const child=spawn(process.execPath,[path.resolve('service.mjs')],{cwd:process.cwd(),detached:true,stdio:'ignore',env:process.env});child.unref();
for(let n=0;n<100&&!fs.existsSync(state);n++)await pause();
if(target)await gate('after-start');
if(target&&phase==='restart-after-start')process.exit(10);
if(!fs.existsSync(state))process.exit(11);}
switch(process.argv[2]){case 'stop':await stop();break;case 'start':await start();break;
case 'restart':await stop();await start();break;
case 'status':{if(target)await gate('health');const h=await probe();if(!h||h.version!==version||(target&&['health','restore-start'].includes(phase)))process.exit(14);break;}
default:throw new Error('unknown fake CLI action');}`);
  git('add', '.'); git('commit', '-qm', 'old'); const old = git('rev-parse', 'HEAD');
  write('version.txt', 'new'); git('add', '.'); git('commit', '-qm', 'new'); const newer = git('rev-parse', 'HEAD');
  write('package-lock.json', 'INVALID LOCK JSON'); git('add', '.'); git('commit', '-qm', 'broken install'); const broken = git('rev-parse', 'HEAD');
  git('checkout', '-q', old);
  write('package.json', JSON.stringify({ name: 'promote-fixture', version: '1.0.0', type: 'module', scripts: {} }));
  write('version.txt', 'legacy'); git('add', '.'); git('commit', '-qm', 'legacy'); const legacy = git('rev-parse', 'HEAD');
  git('checkout', '-q', newer);
  const rel = path.join(dir, 'release'); git('worktree', 'add', '--detach', rel, old);
  const state = path.join(dir, 'service.pid');
  const env = { ...process.env, FAKE_STATE: state, FAKE_PORT: String(port), FAIL_PHASE: '' };
  const cli = (action, cliEnv = env) => run(process.execPath, [path.join(rel, 'bin/pinpoint.mjs'), action], rel, cliEnv);
  t.after(async () => {
    if (fs.existsSync(state)) { try { process.kill(Number(fs.readFileSync(state, 'utf8')), 'SIGTERM'); } catch { /* 已退出 */ } }
    for (let n = 0; n < 100; n++) {
      try { await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(100) }); }
      catch { fs.rmSync(dir, { recursive: true, force: true }); return; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`fixture HTTP process did not stop: ${port}`);
  });
  fs.mkdirSync(path.join(rel, 'node_modules')); fs.writeFileSync(path.join(rel, 'node_modules/old-dep'), 'old');
  const dist = path.join(rel, '.tmp/workbench-dist'); fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), 'old-shell'); fs.writeFileSync(path.join(dist, 'enabled'), '');
  fs.writeFileSync(path.join(dist, 'assets/old-abc.js'), 'old');
  cli('start');
  const home = path.join(dir, 'home');
  const warnings = [];
  const invoke = (target, phase) => promote({ root, rev: target, release: rel, home, log() {}, warn: text => warnings.push(text),
    run: (cmd, args, options) => execFileSync(cmd, args, { ...options, env: { ...env, ...options.env,
      FAKE_STATE: state, FAKE_PORT: String(port), FAIL_PHASE: phase }, stdio: ['ignore', 'pipe', 'pipe'] }) });
  const alive = async () => (await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).json();
  const worker = path.join(dir, 'worker.mjs');
  fs.writeFileSync(worker, `import {promote} from ${JSON.stringify(new URL('./promote.mjs', import.meta.url).href)};
try{await promote({root:process.argv[2],release:process.argv[3],rev:process.argv[4],home:process.argv[5]});}catch(e){console.error(e.message);process.exitCode=1;}`);
  const launch = ({ phase = 'before-start', failure = '', release = rel, rev = newer } = {}) => {
    const gate = path.join(dir, `gate-${Math.random()}`);
    const logfile = gate + '.log';
    const fd = fs.openSync(logfile, 'w');
    const child = spawn(process.execPath, [worker, root, release, rev, home], {
      detached: true, stdio: ['ignore', fd, fd], env: { ...env, GATE_PHASE: phase, FAKE_GATE: gate, FAIL_PHASE: failure },
    });
    fs.closeSync(fd);
    const done = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    t.after(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // 断言失败也让发布者先收尾，避免它自己的命令组失去父进程。
      process.kill(-child.pid, 'SIGTERM');
      const timer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* 已退出 */ } }, 5000);
      try { await done; } finally { clearTimeout(timer); }
    });
    return { child, done, gate, output: () => fs.readFileSync(logfile, 'utf8'),
      entered: () => until(() => fs.existsSync(gate + '.entered')),
      unblock: () => fs.writeFileSync(gate + '.release', '') };
  };
  return { dir, root, rel, dist, home, old, newer, broken, legacy, invoke, alive, warnings,
    launch, actions: () => fs.readFileSync(state + '.actions', 'utf8'),
    recover: script => run('sh', [script], rel, env), head: () => run('git', ['rev-parse', 'HEAD'], rel) };
}

async function until(predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待真实子进程阶段超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('promote：真实进程组 SIGINT/SIGTERM 在构建、起新前后与健康检查中安全收尾', async t => {
  for (const signal of ['SIGINT', 'SIGTERM']) for (const phase of ['build', 'before-start', 'after-start', 'health']) {
    await t.test(`${signal} ${phase}`, async t => {
      const f = await fixture(t);
      const p = f.launch({ phase });
      await p.entered();
      process.kill(-p.child.pid, signal);
      const result = await p.done;
      assert.notEqual(result.code, 0);
      assert.deepEqual(await f.alive(), { version: 'old', deps: 'old', shell: 'old-shell' });
      assert.equal(f.head(), f.old);
      if (phase === 'build') assert.equal(f.actions(), 'start:old\n');
      else assert.match(f.actions(), /start:old\nstatus:old\n$/);
      assert.match(p.output(), new RegExp(signal));
      assert.deepEqual(fs.readdirSync(path.join(f.root, '.tmp')), []);
    });
  }
});

test('promote：信号收尾恢复也失败时打印完整可执行命令', async t => {
  const f = await fixture(t);
  const p = f.launch({ failure: 'restore-start' });
  await p.entered();
  process.kill(-p.child.pid, 'SIGTERM');
  assert.notEqual((await p.done).code, 0);
  const output = p.output();
  assert.match(output, /SIGTERM.*旧服务恢复失败.*恢复命令：sh '/s);
  const [, script] = output.match(/恢复命令：sh '([^']+)'/);
  assert.equal(fs.existsSync(script), true);
  f.recover(script);
  assert.deepEqual(await f.alive(), { version: 'old', deps: 'old', shell: 'old-shell' });
});

// 复审场景 11：第一次组信号触发收尾后，恢复期再打一次组信号（终端 Ctrl-C 的真实形态），
// 恢复命令会被组信号直接打死（execFile detached 实测未脱离 promote 的进程组），不得留下停服。
test('promote：恢复期第二次组信号打死恢复命令也不留停服', async t => {
  const f = await fixture(t);
  const p = f.launch({ phase: '', failure: 'interrupt2' });
  await until(() => fs.existsSync(p.gate + '.target')); // 起新服务挂起
  process.kill(-p.child.pid, 'SIGINT'); // 第一次组信号：进入收尾
  await until(() => fs.existsSync(p.gate + '.restore')); // 恢复序列 start(old) 挂起
  process.kill(-p.child.pid, 'SIGINT'); // 第二次组信号：直接命中恢复命令
  fs.writeFileSync(p.gate + '.restore.release', '');
  const result = await p.done;
  assert.equal(result.signal, null, p.output());
  const output = p.output();
  assert.match(output, /收到 SIGINT，发布已中止/);
  assert.doesNotMatch(output, /旧服务恢复失败/);
  assert.deepEqual(await f.alive(), { version: 'old', deps: 'old', shell: 'old-shell' });
  assert.equal(f.head(), f.old);
  assert.deepEqual(fs.readdirSync(path.join(f.root, '.tmp')), []);
});

// 单发非组信号（systemd/supervisor 停服务的默认形态）：子命令不在独立进程组时 kill(-pid) 是
// 空枪，转发必须直接命中挂起的子命令本身。
test('promote：单发非组信号也转发给挂起的子命令', async t => {
  const f = await fixture(t);
  const p = f.launch({ phase: '', failure: 'interrupt2' });
  await until(() => fs.existsSync(p.gate + '.target'));
  process.kill(p.child.pid, 'SIGINT'); // 只打 promote 进程本身
  let forwarded = false;
  for (let n = 0; n < 250 && !(forwarded = fs.existsSync(p.gate + '.restore')); n++) await new Promise(resolve => setTimeout(resolve, 20));
  if (!forwarded) { // 空枪：子命令仍挂在起新上，收尾只能等命令完成后的 interrupted 检查
    fs.writeFileSync(p.gate + '.target.release', '');
    for (let n = 0; n < 250 && !fs.existsSync(p.gate + '.restore'); n++) await new Promise(resolve => setTimeout(resolve, 20));
    fs.writeFileSync(p.gate + '.restore.release', '');
    await p.done;
    assert.fail('单发 SIGINT 应转发给挂起的子命令并进入收尾');
  }
  fs.writeFileSync(p.gate + '.restore.release', '');
  const result = await p.done;
  assert.equal(result.signal, null, p.output());
  assert.match(p.output(), /收到 SIGINT，发布已中止/);
  assert.deepEqual(await f.alive(), { version: 'old', deps: 'old', shell: 'old-shell' });
  assert.equal(f.head(), f.old);
});

test('promote：同一规范 release 路径跨进程互斥，A 成功、B 立即拒绝，后续发布重读 prev', async t => {
  const f = await fixture(t);
  const a = f.launch({ phase: 'build' });
  await a.entered();
  const alias = path.join(f.dir, 'release-alias');
  fs.symlinkSync(f.rel, alias, 'dir');
  const b = f.launch({ phase: '', failure: 'health', release: alias });
  assert.notEqual((await b.done).code, 0);
  assert.match(b.output(), /发布锁.*持有/);
  assert.ok(b.output().includes(String(a.child.pid)), '拒绝消息必须说明持有者 PID');
  assert.equal(fs.existsSync(b.gate + '.entered'), false);
  assert.equal(f.head(), f.old);
  assert.equal(f.actions(), 'start:old\n');
  a.unblock();
  assert.equal((await a.done).code, 0, a.output());
  assert.deepEqual(await f.alive(), { version: 'new', deps: 'old', shell: 'new-shell' });
  assert.equal(f.head(), f.newer);
  // 新进程拿到已释放的锁后，prev 必须来自 A 成功后的 release。
  const c = f.launch({ phase: '', rev: f.legacy });
  assert.equal((await c.done).code, 0, c.output());
  assert.match(c.output(), new RegExp(`${f.newer.slice(0, 7)} -> ${f.legacy.slice(0, 7)}`));
  assert.deepEqual(await f.alive(), { version: 'legacy', deps: 'old', shell: 'new-shell' });
  assert.equal(fs.existsSync(path.join(f.rel, '.tmp/promote.lock')), false);
});

test('promote 真实生命周期：review 七个场景', async t => {
  for (const [name, revision, phase, fails] of [
    ['构建失败保旧', 'newer', 'build', true],
    ['npm ci 失败保旧', 'broken', '', true],
    ['停旧后起新失败恢复旧服务', 'newer', 'restart-before-start', true],
    ['起新后返回失败先停新再恢复旧服务', 'newer', 'restart-after-start', true],
    ['回滚 legacy', 'legacy', '', false],
    ['成功发布 bundle', 'newer', '', false],
    ['健康后发布日志失败不回滚', 'newer', 'log', false],
  ]) await t.test(name, async t => {
    const f = await fixture(t);
    if (phase === 'log') { fs.mkdirSync(path.join(f.home, '.pinpoint'), { recursive: true }); fs.writeFileSync(path.join(f.home, '.pinpoint/logs'), 'blocked'); }
    if (fails) await assert.rejects(() => f.invoke(f[revision], phase));
    else await f.invoke(f[revision], phase);
    const version = fails ? 'old' : revision === 'legacy' ? 'legacy' : 'new';
    const shell = version === 'new' ? 'new-shell' : 'old-shell';
    assert.deepEqual(await f.alive(), { version, deps: 'old', shell });
    assert.equal(f.head(), fails ? f.old : f[revision]);
    assert.equal(fs.readFileSync(path.join(f.dist, 'index.html'), 'utf8'), shell);
    assert.equal(fs.existsSync(path.join(f.dist, 'enabled')), version !== 'legacy');
    if (phase === 'log') assert.match(f.warnings.join('\n'), /日志/);
  });
});

test('promote：新服务健康检查失败也恢复旧 HTTP 服务', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.invoke(f.newer, 'health'));
  assert.deepEqual(await f.alive(), { version: 'old', deps: 'old', shell: 'old-shell' });
});

test('promote：恢复启动也失败，保留材料并给出可执行的完整恢复命令', async t => {
  const f = await fixture(t);
  await assert.rejects(() => f.invoke(f.newer, 'restore-start'), /恢复.*失败.*recovery\.sh/s);
  const [kept] = fs.readdirSync(path.join(f.root, '.tmp'));
  const script = fs.readFileSync(path.join(f.root, '.tmp', kept, 'recovery.sh'), 'utf8');
  assert.match(script, /stop/); assert.match(script, /checkout/); assert.match(script, /start/); assert.match(script, /status/);
  assert.equal(f.head(), f.old);
  f.recover(path.join(f.root, '.tmp', kept, 'recovery.sh'));
  assert.deepEqual(await f.alive(), { version: 'old', deps: 'old', shell: 'old-shell' });
});
