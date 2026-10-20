import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';
import { promote } from './promote.mjs';

// 来自 review 的 promote-lifecycle.mjs：Git、npm 与 HTTP 服务都是真的，只有 CLI 是隔离固件。
// 不能只断言 checkout：失败后必须观察到旧 HTTP 进程重新健康，而非“新进程 + 旧磁盘”。
async function fixture(t, { gatedShutdown = false } = {}) {
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
${waitFile.toString()}
if(process.env.FAIL_PHASE==='build')process.exit(7);
if(process.env.GATE_PHASE==='build'){fs.writeFileSync(process.env.FAKE_GATE+'.entered','');await waitFile(process.env.FAKE_GATE+'.release');}
const d=process.env.PINPOINT_WORKBENCH_DIST;fs.mkdirSync(path.join(d,'assets'),{recursive:true});
fs.writeFileSync(path.join(d,'index.html'),'new-shell');fs.writeFileSync(path.join(d,'assets/new-abc123.js'),'new-asset');`);
  write('version.txt', 'old');
  write('service.mjs', `import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
${waitFile.toString()}
process.on('exit',()=>{if(fs.existsSync(process.env.FAKE_STATE)&&fs.readFileSync(process.env.FAKE_STATE,'utf8')===String(process.pid))fs.rmSync(process.env.FAKE_STATE);});
const version=fs.readFileSync(new URL('./version.txt',import.meta.url),'utf8');
const deps=fs.existsSync(new URL('./node_modules/old-dep',import.meta.url))?'old':'new';
const shell=fs.readFileSync(new URL('./.tmp/workbench-dist/index.html',import.meta.url),'utf8');
const server=http.createServer((q,s)=>s.end(JSON.stringify({version,deps,shell})));
server.listen(Number(process.env.FAKE_PORT),'127.0.0.1',()=>{fs.writeFileSync(process.env.FAKE_STATE,String(process.pid));process.send('ready');process.disconnect();});
process.on('SIGTERM',async()=>{if(process.env.FAKE_SHUTDOWN_GATE){fs.writeFileSync(process.env.FAKE_SHUTDOWN_GATE+'.entered','');await waitFile(process.env.FAKE_SHUTDOWN_GATE+'.release');}server.close(()=>process.exit(0));});`);
  write('bin/pinpoint.mjs', `import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';import http from 'node:http';
${waitFile.toString()}
${readService.toString()}
const state=process.env.FAKE_STATE,phase=process.env.FAIL_PHASE;
const version=fs.readFileSync('version.txt','utf8');const target=version==='new';
fs.appendFileSync(process.env.FAKE_STATE+'.actions',process.argv[2]+':'+version+'\\n');
async function gate(phase){if(process.env.GATE_PHASE!==phase||fs.existsSync(process.env.FAKE_GATE+'.entered'))return;fs.writeFileSync(process.env.FAKE_GATE+'.entered','');await waitFile(process.env.FAKE_GATE+'.release');}
async function hold(marker){fs.writeFileSync(marker+'.pid',String(process.pid));fs.writeFileSync(marker,'');await waitFile(marker+'.release');}
async function probe(){try{return await readService(Number(process.env.FAKE_PORT));}catch{return null;}}
// HTTP 轮询会向正在 close 的服务持续送请求，不能用它判定停止。PID 由服务退出时注销。
async function stop(){if(fs.existsSync(state)){try{process.kill(Number(fs.readFileSync(state,'utf8')),'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;fs.rmSync(state,{force:true});}}await gate('stopping');await waitFile(state,false);}
async function start(){
if(target&&phase==='interrupt2')await hold(process.env.FAKE_GATE+'.target');
if(!target&&phase==='interrupt2')await hold(process.env.FAKE_GATE+'.restore');
if(target)await gate('before-start');
if(target&&phase==='restart-before-start')process.exit(9);
if(!target&&phase==='restore-start')process.exit(13);
const child=spawn(process.execPath,[path.resolve('service.mjs')],{cwd:process.cwd(),detached:true,stdio:['ignore','ignore','ignore','ipc'],env:process.env});
const ready=once(child,'message');
await Promise.race([ready,once(child,'exit').then(([code,signal])=>{throw new Error('service exited before ready: '+code+' '+signal);})]);child.unref();
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
  const env = { ...process.env, FAKE_STATE: state, FAKE_PORT: String(port), FAIL_PHASE: '', FAKE_SHUTDOWN_GATE: gatedShutdown ? path.join(dir, 'shutdown') : '' };
  const cli = (action, cliEnv = env) => run(process.execPath, [path.join(rel, 'bin/pinpoint.mjs'), action], rel, cliEnv);
  const publishers = [];
  t.after(async () => {
    for (const settle of publishers.reverse()) await settle();
    if (env.FAKE_SHUTDOWN_GATE) fs.writeFileSync(env.FAKE_SHUTDOWN_GATE + '.release', '');
    if (fs.existsSync(state)) { try { process.kill(Number(fs.readFileSync(state, 'utf8')), 'SIGTERM'); } catch { /* 已退出 */ } }
    await waitFile(state, false);
    // 退出标记之后再实际占用一次端口，不能把请求超时或断连当成已释放。
    const listener = net.createServer();
    try {
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(port, '127.0.0.1', resolve);
      });
    } finally { if (listener.listening) await new Promise(resolve => listener.close(resolve)); }
    fs.rmSync(dir, { recursive: true, force: true });
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
  const alive = () => readService(port);
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
    publishers.push(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      // 断言失败也释放本用例所有 gate，再由发布者完成恢复，最后等退出事件。
      for (const suffix of ['.release', '.target.release', '.restore.release']) fs.writeFileSync(gate + suffix, '');
      child.kill('SIGTERM');
      await done;
    });
    return { child, done, gate, output: () => fs.readFileSync(logfile, 'utf8'),
      entered: () => waitFile(gate + '.entered'),
      unblock: () => fs.writeFileSync(gate + '.release', '') };
  };
  return { env, state, port, dir, root, rel, dist, home, old, newer, broken, legacy, invoke, alive, warnings,
    launch, actions: () => fs.readFileSync(state + '.actions', 'utf8'),
    recover: script => run('sh', [script], rel, env), head: () => run('git', ['rev-parse', 'HEAD'], rel) };
}

// 15 秒仅作卡死诊断；每次观察实际文件状态，不用轮询次数推断完成。
// macOS 的目录 fs.watch 在并发创建/删除下实测丢通知，watchFile 直接观察目标的 stat。
async function waitFile(file, present = true) {
  if (fs.existsSync(file) === present) return;
  await new Promise((resolve, reject) => {
    const finish = error => { clearTimeout(timer); fs.unwatchFile(file, check); error ? reject(error) : resolve(); };
    const check = () => { if (fs.existsSync(file) === present) finish(); };
    fs.watchFile(file, { interval: 20 }, check);
    const timer = setTimeout(() => finish(new Error(`等待真实子进程文件超时：${file} (${present})`)), 15000);
    check();
  });
}

// 每次实读 HTTP 正文并关闭连接，不把存活探测留在服务的关闭序列里。
function readService(port) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, agent: false }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.once('error', reject);
      res.once('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    req.once('error', reject);
  });
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
  await waitFile(p.gate + '.target'); // 起新服务挂起
  process.kill(-p.child.pid, 'SIGINT'); // 第一次组信号：进入收尾
  await waitFile(p.gate + '.restore'); // 恢复序列 start(old) 挂起
  process.kill(-p.child.pid, 'SIGINT'); // 第二次组信号：直接命中恢复命令
  fs.writeFileSync(p.gate + '.restore.release', '');
  const result = await p.done;
  assert.equal(result.signal, null, p.output());
  const output = p.output();
  assert.match(output, /收到 SIGINT，发布已中止/);
  assert.match(output, /旧服务已恢复并验证健康/);
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
  await waitFile(p.gate + '.target');
  process.kill(p.child.pid, 'SIGINT'); // 只打 promote 进程本身
  await waitFile(p.gate + '.restore');
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

// 关闭刻意由 gate 挂起：SIGTERM 已送达不代表服务已经退出，PID 不能提前丢掉。
test('生命周期固件：停止等服务完成关闭才注销 PID 并释放端口', async t => {
  const f = await fixture(t, { gatedShutdown: true });
  const gate = path.join(f.dir, 'stop-command');
  const child = spawn(process.execPath, [path.join(f.rel, 'bin/pinpoint.mjs'), 'stop'], {
    cwd: f.rel, env: { ...f.env, GATE_PHASE: 'stopping', FAKE_GATE: gate }, stdio: 'ignore',
  });
  const done = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  try {
    await waitFile(gate + '.entered');
    await waitFile(f.env.FAKE_SHUTDOWN_GATE + '.entered');
    assert.equal(fs.existsSync(f.state), true, '服务仍被关闭 gate 挂起时必须保留 PID');
  } finally {
    fs.writeFileSync(f.env.FAKE_SHUTDOWN_GATE + '.release', '');
    fs.writeFileSync(gate + '.release', '');
    assert.deepEqual(await done, { code: 0, signal: null });
  }
  assert.equal(fs.existsSync(f.state), false);
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(f.port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => listener.close(resolve));
});
