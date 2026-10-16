import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchLogos, logoVariants, placeholderSvg, addLogos, normalizeLogoSvg } from './logo.js';
import { run } from '../pinpoint-cli.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppnt-logo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pageDir = path.join(root, 'docs/pinpoint/articles/story');
  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(pageDir + '/index.mdx', '---\ntitle: Logo\n---\n');
  const registry = path.join(root, 'registry.json');
  fs.writeFileSync(registry, JSON.stringify({ entries: [{ id: 'demo', kind: 'project', path: root }] }));
  return { root, pageDir, registry };
}

function capture(env = {}) {
  const output = [], errors = [];
  return { output, errors, io: { env, out: (s) => output.push(s), err: (s) => errors.push(s), requestFn: () => { throw new Error('不允许访问服务'); } } };
}

test('search 离线列出两个集的名字、变体和品牌色，大小写不影响结果', () => {
  assert.deepEqual(searchLogos('GitHub'), searchLogos('github'));
  assert.ok(searchLogos('github').some((r) => r.name === 'github' && r.color === 'github-icon' && r.mono === 'github' && r.hex === '#181717'));
  assert.deepEqual(searchLogos('not-a-real-brand-90210'), []);
  assert.equal(logoVariants('google-gmail').mono, 'gmail');
  assert.equal(logoVariants('gcal').mono, 'googlecalendar');
});

test('add 同时存彩色和 currentColor SVG，manifest 合并保留来源与品牌色', async (t) => {
  const target = fixture(t);
  const [row] = await addLogos(target, ['github']);
  const color = fs.readFileSync(path.join(target.pageDir, row.files.color), 'utf8');
  const mono = fs.readFileSync(path.join(target.pageDir, row.files.mono), 'utf8');
  assert.match(color, /<svg[^>]+viewBox=/);
  assert.match(mono, /currentColor/);
  assert.equal(row.hex, '#181717');
  await addLogos(target, ['google']);
  const manifest = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'assets/logos/logos.json')));
  assert.equal(manifest.github.sources.color, 'logos:github-icon');
  assert.ok(manifest.google);
});

test('add 网络只在 --app 调用，国家和 PNG 字节正确', async (t) => {
  const target = fixture(t), calls = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const fetchFn = async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? { ok: true, json: async () => ({ results: [{ trackId: 12, trackName: '飞书', artworkUrl512: 'https://example.org/icon.png' }] }) } : { ok: true, arrayBuffer: async () => png };
  };
  const [row] = await addLogos(target, ['飞书'], { app: true, country: 'cn', fetchFn });
  assert.equal(new URL(calls[0]).searchParams.get('country'), 'cn');
  assert.equal(new URL(calls[0]).searchParams.get('entity'), 'software');
  assert.equal(new URL(calls[0]).searchParams.get('term'), '飞书');
  assert.equal(calls.length, 2);
  assert.deepEqual(fs.readFileSync(path.join(target.pageDir, row.files.app)), png);
  assert.equal(row.sources.app.trackId, 12);
});

test('App Store 无结果、HTTP 失败和非 PNG 会明确报错', async (t) => {
  const target = fixture(t);
  await assert.rejects(addLogos(target, ['fake'], { app: true, fetchFn: async () => ({ ok: true, json: async () => ({ results: [] }) }) }), /找不到/);
  await assert.rejects(addLogos(target, ['fake'], { app: true, fetchFn: async () => ({ ok: false, status: 503 }) }), /503/);
  let count = 0;
  await assert.rejects(addLogos(target, ['fake'], { app: true, fetchFn: async () => ++count === 1 ? { ok: true, json: async () => ({ results: [{ trackName: 'fake', artworkUrl512: 'https://example.org/x' }] }) } : { ok: true, arrayBuffer: async () => Buffer.from('not-png') } }), /不是 PNG/);
});

test('placeholder 同名同色、可转义 XML，仅缺失时生成', async (t) => {
  assert.equal(placeholderSvg('Acme'), placeholderSvg(' acme '));
  assert.notEqual(placeholderSvg('Acme'), placeholderSvg('Other'));
  assert.match(placeholderSvg('<script>'), /&lt;/);
  const target = fixture(t);
  await assert.rejects(addLogos(target, ['imaginary-90210']), /找不到/);
  const [row, real] = await addLogos(target, ['imaginary-90210', 'github'], { placeholder: true });
  assert.match(fs.readFileSync(path.join(target.pageDir, row.files.placeholder), 'utf8'), /<text/);
  assert.ok(real.files.color);
  assert.equal(real.files.placeholder, undefined);
});

test('素材目录或输出文件是越界 symlink 时拒绝写入', async (t) => {
  const target = fixture(t);
  fs.mkdirSync(path.join(target.root, 'external'));
  fs.symlinkSync(path.join(target.root, 'external'), path.join(target.pageDir, 'assets'));
  await assert.rejects(addLogos(target, ['github']), /越出/);
});

test('CLI add 使用文章解析器，输出 JSX、MDX 和 mono mask，不联系服务', async (t) => {
  const f = fixture(t), c = capture({ PINPOINT_REGISTRY: f.registry, PINPOINT_ORIGIN: 'http://127.0.0.1:1' });
  assert.equal(await run(['logo', 'add', 'https://example.org/demo/story/', 'github'], c.io), 0, c.errors.join('\n'));
  assert.match(c.output.join('\n'), /JSX 帧和 MDX/);
  assert.match(c.output.join('\n'), /\/sites\/demo_story\/assets\/logos\/github.svg/);
  assert.match(c.output.join('\n'), /WebkitMask/);
});

test('CLI search --json 只有一个可解析文档；不读取 registry', async () => {
  const c = capture({ PINPOINT_REGISTRY: '/does-not-exist' });
  assert.equal(await run(['logo', 'search', 'github', '--json'], c.io), 0);
  const result = JSON.parse(c.output.join('\n'));
  assert.equal(result.ok, true);
  assert.match(result.output.join('\n'), /github-icon/);
});

test('CLI help 和错误参数退出码；缺文章不会创建目录', async (t) => {
  const f = fixture(t);
  for (const args of [['--help'], ['search'], ['add', 'demo/missing', 'github'], ['add', 'demo/story', 'github', '--country', 'cn'], ['search', 'github', '--app'], ['add', 'demo/story', 'github', '--app=false']]) {
    const c = capture({ PINPOINT_REGISTRY: f.registry });
    assert.equal(await run(['logo', ...args], c.io), args[0] === '--help' ? 0 : 2, args.join(' '));
  }
  assert.equal(fs.existsSync(path.join(f.pageDir, 'assets')), false);
});

 test('Apple artwork 的 JPEG 缩略图请求 PNG，manifest 同时保留原 URL', async (t) => {
  const target = fixture(t), calls = [];
  const original = 'https://is1-ssl.mzstatic.com/image/thumb/app/512x512bb.jpg';
  const [row] = await addLogos(target, ['gmail'], { app: true, fetchFn: async (url) => {
    calls.push(String(url));
    return calls.length === 1 ? { ok: true, json: async () => ({ results: [{ trackName: 'Gmail', artworkUrl512: original }] }) } : { ok: true, arrayBuffer: async () => Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  } });
  assert.equal(calls[1], original.replace('.jpg', '.png'));
  assert.equal(row.sources.app.artworkUrl512, original);
  assert.equal(logoVariants('google').color, 'google-icon');
});

 test('App Store 的相似搜索结果不能冒充品牌 logo', async (t) => {
  const target = fixture(t);
  await assert.rejects(addLogos(target, ['allbirds'], { app: true, fetchFn: async () => ({ ok: true, json: async () => ({ results: [{ trackName: 'eBird', artworkUrl512: 'https://example.org/a.png' }] }) }) }), /不匹配/);
  assert.equal(fs.existsSync(path.join(target.pageDir, 'assets/logos/allbirds-app.png')), false);
});

 test('CLI 联网失败退 1，参数错误退 2', async (t) => {
  const f = fixture(t), c = capture({ PINPOINT_REGISTRY: f.registry });
  c.io.fetchFn = async () => ({ ok: false, status: 503 });
  assert.equal(await run(['logo', 'add', 'demo/story', 'gmail', '--app'], c.io), 1);
  assert.match(c.errors.join(' '), /503/);
  assert.equal(await run(['logo', 'add', 'demo/story', 'missing-90210'], c.io), 2);
});

test('add 按图形边界生成方形 viewBox，列表和 hero 共享同一套居中素材', async (t) => {
  const target = fixture(t);
  const rows = await addLogos(target, ['google', 'github', 'visa', 'cursor']);
  for (const row of rows) {
    for (const file of [row.files.color, row.files.mono].filter(Boolean)) {
      const svg = fs.readFileSync(path.join(target.pageDir, file), 'utf8');
      const viewBox = svg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
      assert.equal(viewBox[2], viewBox[3], `${row.name} ${file} 的 viewBox 必须是方形`);
    }
  }
});


test('SVG 方形裁边按实际图形和 transform 计算，不按原画布或曲线控制点计算', () => {
  const rect = normalizeLogoSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g transform="translate(30 40)"><rect width="10" height="20" fill="red"/></g></svg>');
  assert.match(rect, /viewBox="25 40 20 20"/);
  assert.match(rect, /transform="translate\(30 40\)"/);
  const curve = normalizeLogoSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0 C0 100 100 100 100 0" fill="blue"/></svg>');
  assert.match(curve, /viewBox="0 -12.5 100 100"/);
});
