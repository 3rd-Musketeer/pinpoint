import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { searchLogos, logoVariants, placeholderSvg, addLogos, normalizeLogoSvg } from './logo.js';
import { run } from './dispatch.js';
import { Resvg } from '@resvg/resvg-js';

const PNG = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>').render().asPng();

function visualArea(svg, color = '#000') {
  const { pixels, width, height } = new Resvg(svg.replace(/currentColor/g, color), { fitTo: { mode: 'width', value: 512 }, font: { loadSystemFonts: false } }).render();
  let area = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    area += pixels[i + 3] / 255 * (1 - (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255);
  }
  return area / (width * height);
}

test('白底上的 Kimi 与 Google 视觉面积接近，稀疏横长字标保持可读', async (t) => {
  const target = fixture(t);
  const rows = await addLogos(target, ['google', 'kimi', 'visa']);
  const svg = (row) => fs.readFileSync(path.join(target.pageDir, row.files.color || row.files.mono), 'utf8');
  const google = visualArea(svg(rows[0]));
  const kimi = visualArea(svg(rows[1]), rows[1].hex);
  assert.ok(kimi / google < 1.1, `Kimi / Google = ${kimi / google}`);
  assert.ok(kimi / google > 0.9);
  const visa = svg(rows[2]);
  const box = new Resvg(visa).getBBox();
  const side = Number(visa.match(/viewBox="([^"]+)"/)[1].split(/\s+/)[2]);
  assert.ok(Math.abs(side - box.width) < 0.00001, '横长 Visa 不应继续缩小');
});

test('实心图形最多缩小 20%，重复生成稳定且不裁掉原图形', () => {
  const source = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="20" y="30" width="40" height="40"/></svg>';
  const result = normalizeLogoSvg(source);
  assert.match(result, /viewBox="15 25 50 50"/);
  assert.equal(normalizeLogoSvg(result), result);
});

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
  const png = PNG;
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
  const example = c.output.find(line => line.startsWith('JSX 帧和 MDX')).split('\n').slice(1).join('\n');
  fs.mkdirSync(path.join(f.pageDir, 'components'));
  fs.writeFileSync(path.join(f.pageDir, 'components/Fav.jsx'), example);
  fs.writeFileSync(path.join(f.pageDir, 'example.jsx'), "import { Fav } from './components/Fav.jsx';\nexport default function Example() { return <Fav site=\"github\" />; }\n");
  const rendered = capture({ PINPOINT_REGISTRY: f.registry });
  assert.equal(await run(['render', 'demo/story/example', '--full'], rendered.io), 0, rendered.errors.join('\n'));
  assert.match(rendered.output.join('\n'), /github.svg/);
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
    return calls.length === 1 ? { ok: true, json: async () => ({ results: [{ trackName: 'Gmail', artworkUrl512: original }] }) } : { ok: true, arrayBuffer: async () => PNG };
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

test('实际品牌 SVG 的 viewBox 是以图形居中的方形', async (t) => {
  const target = fixture(t);
  const rows = await addLogos(target, ['google', 'github', 'visa', 'cursor']);
  for (const row of rows) {
    for (const file of [row.files.color, row.files.mono].filter(Boolean)) {
      const svg = fs.readFileSync(path.join(target.pageDir, file), 'utf8');
      const viewBox = svg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
      assert.equal(viewBox[2], viewBox[3], `${row.name} ${file} 的 viewBox 必须是方形`);
      const box = new Resvg(svg, { font: { loadSystemFonts: false } }).getBBox();
      assert.ok(Math.abs((viewBox[0] + viewBox[2] / 2) - (box.x + box.width / 2)) < 0.00001);
      assert.ok(Math.abs((viewBox[1] + viewBox[3] / 2) - (box.y + box.height / 2)) < 0.00001);
    }
  }
});


test('SVG 方形留白按实际图形和 transform 居中，不按原画布或曲线控制点计算', () => {
  const rect = normalizeLogoSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><g transform="translate(30 40)"><rect width="10" height="20" fill="red"/></g></svg>');
  assert.match(rect, /transform="translate\(30 40\)"/);
  const curve = normalizeLogoSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M0 0 C0 100 100 100 100 0" fill="blue"/></svg>');
  for (const [svg, cx, cy, minimum] of [[rect, 35, 50, 20], [curve, 50, 37.5, 100]]) {
    const [x, y, w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
    assert.equal(w, h);
    assert.ok(w >= minimum, '留白不能裁掉实际图形');
    assert.ok(Math.abs(x + w / 2 - cx) < 0.00001);
    assert.ok(Math.abs(y + h / 2 - cy) < 0.00001);
  }
});

test('单色 alias 复用 parent 的品牌色', () => {
  assert.equal(logoVariants('chromecast').hex, '#4285F4');
  assert.equal(logoVariants('nuxtdotjs').hex, '#00DC82');
});

test('App 下载失败不会覆盖已有素材或留下未登记 SVG', async (t) => {
  const target = fixture(t);
  const output = path.join(target.pageDir, 'assets/logos');
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'gmail.svg'), 'keep existing');
  const failed = () => ({ ok: false, status: 503 });
  await assert.rejects(addLogos(target, ['gmail'], { app: true, fetchFn: failed }), /503/);
  assert.deepEqual(fs.readdirSync(output), ['gmail.svg']);
  assert.equal(fs.readFileSync(path.join(output, 'gmail.svg'), 'utf8'), 'keep existing');
});

test('并发下载完成后合并最新 manifest，不丢另一批记录', async (t) => {
  const target = fixture(t);
  let resume;
  const wait = new Promise(resolve => { resume = resolve; });
  const png = PNG;
  const slow = addLogos(target, ['gmail'], { app: true, fetchFn: async (url) => {
    if (String(url).includes('itunes.apple.com')) {
      await wait;
      return { ok: true, json: async () => ({ results: [{ trackId: 12, trackName: 'Gmail', artworkUrl512: 'https://example.org/icon.png' }] }) };
    }
    return { ok: true, arrayBuffer: async () => png };
  } });
  await addLogos(target, ['github']);
  resume();
  await slow;
  const manifest = JSON.parse(fs.readFileSync(path.join(target.pageDir, 'assets/logos/logos.json')));
  assert.deepEqual(Object.keys(manifest).sort(), ['github', 'gmail']);
});

test('错误形状的 manifest 拒绝写入，保留原文与目录', async (t) => {
  for (const value of ['[]', 'null', '"text"', '{"github":{"name":"github","files":[],"sources":{}}}']) {
    const target = fixture(t), output = path.join(target.pageDir, 'assets/logos');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'logos.json'), value);
    await assert.rejects(addLogos(target, ['github']), /manifest|清单/);
    assert.equal(fs.readFileSync(path.join(output, 'logos.json'), 'utf8'), value);
    assert.deepEqual(fs.readdirSync(output), ['logos.json']);
  }
});

test('固定命名的未登记 SVG、App PNG 和 placeholder 可重写，其他文件保留', async (t) => {
  const target = fixture(t), output = path.join(target.pageDir, 'assets/logos');
  fs.mkdirSync(output, { recursive: true });
  for (const file of ['github.svg', 'github-mono.svg', 'github-app.png', 'github-app.jpg', 'custom.svg', 'unknown-brand-90210.svg']) {
    fs.writeFileSync(path.join(output, file), 'old');
  }
  const [row] = await addLogos(target, ['github'], { app: true, fetchFn: async (url) => String(url).includes('itunes.apple.com')
    ? { ok: true, json: async () => ({ results: [{ trackId: 12, trackName: 'GitHub', artworkUrl512: 'https://example.org/icon.png' }] }) }
    : { ok: true, arrayBuffer: async () => PNG } });
  assert.match(fs.readFileSync(path.join(target.pageDir, row.files.color), 'utf8'), /<svg/);
  assert.match(fs.readFileSync(path.join(target.pageDir, row.files.mono), 'utf8'), /<svg/);
  assert.deepEqual(fs.readFileSync(path.join(target.pageDir, row.files.app)), PNG);
  const [placeholder] = await addLogos(target, ['unknown-brand-90210'], { placeholder: true });
  assert.match(fs.readFileSync(path.join(target.pageDir, placeholder.files.placeholder), 'utf8'), /<text/);
  for (const file of ['github-app.jpg', 'custom.svg']) {
    assert.equal(fs.readFileSync(path.join(output, file), 'utf8'), 'old');
  }
});

test('同名 slug 冲突不改已有品牌', async (t) => {
  const target = fixture(t), output = path.join(target.pageDir, 'assets/logos');
  await addLogos(target, ['a b'], { placeholder: true });
  await assert.rejects(addLogos(target, ['a-b'], { placeholder: true }), /冲突/);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'logos.json')));
  assert.equal(manifest['a-b'].name, 'a b');
});

test('文章内部的输出 symlink 不能覆盖其指向的其他文件', async (t) => {
  const target = fixture(t), output = path.join(target.pageDir, 'assets/logos');
  fs.mkdirSync(output, { recursive: true });
  const unrelated = path.join(target.pageDir, 'unrelated.svg');
  fs.writeFileSync(unrelated, 'keep');
  fs.symlinkSync(unrelated, path.join(output, 'github.svg'));
  await assert.rejects(addLogos(target, ['github']), /symlink|符号链接|覆盖/);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'keep');
});

test('CLI search 接受通用 --registry 选项但不读取文件', async () => {
  const c = capture();
  assert.equal(await run(['logo', 'search', 'github', '--registry', '/not/read'], c.io), 0, c.errors.join('\n'));
});

test('重新添加 SVG 时保留已经下载的 App PNG 与来源', async (t) => {
  const target = fixture(t);
  const png = PNG;
  const [first] = await addLogos(target, ['gmail'], { app: true, fetchFn: async (url) => String(url).includes('itunes.apple.com')
    ? { ok: true, json: async () => ({ results: [{ trackId: 12, trackName: 'Gmail', artworkUrl512: 'https://example.org/icon.png' }] }) }
    : { ok: true, arrayBuffer: async () => png } });
  const [updated] = await addLogos(target, ['gmail']);
  assert.equal(updated.files.app, first.files.app);
  assert.deepEqual(updated.sources.app, first.sources.app);
});

test('CLI 打印可编译的唯一品牌组件，选择一张图并应用统一尺寸', async (t) => {
  const f = fixture(t), c = capture({ PINPOINT_REGISTRY: f.registry });
  assert.equal(await run(['logo', 'add', 'demo/story', 'github', 'kimi', 'unknown-brand-90210', '--placeholder'], c.io), 0);
  const example = c.output.find(line => line.startsWith('JSX 帧和 MDX')).split('\n').slice(1).join('\n');
  const { transform } = await import('esbuild');
  const { h } = await import('preact');
  const { renderToString } = await import('preact-render-to-string');
  const { code } = await transform(example, { loader: 'jsx', format: 'cjs', jsxFactory: 'h' });
  const mod = { exports: {} };
  new Function('h', 'module', 'exports', code)(h, mod, mod.exports);
  assert.equal(typeof mod.exports.Fav, 'function');
  const color = renderToString(h(mod.exports.Fav, { site: 'github', size: 32 }));
  assert.match(color, /border-radius:25%/);
  assert.match(color, /0.5px solid/);
  assert.match(color, /width:23.04px/);
  assert.equal((color.match(/<img /g) || []).length, 1);
  assert.doesNotMatch(color, /github-mono/);
  const mono = renderToString(h(mod.exports.Fav, { site: 'kimi', size: 32 }));
  assert.match(mono, /mask:/);
  assert.match(mono, /kimi-mono.svg/);
  const placeholder = renderToString(h(mod.exports.Fav, { site: 'unknown-brand-90210', size: 32 }));
  assert.match(placeholder, /border:0/);
});

test('已占用的写锁明确报错，不写素材、不删除别人的锁', async (t) => {
  const f = fixture(t), output = path.join(f.pageDir, 'assets/logos');
  fs.mkdirSync(path.join(output, '.write-lock'), { recursive: true });
  await assert.rejects(addLogos(f, ['github']), /正在写入/);
  assert.deepEqual(fs.readdirSync(output), ['.write-lock']);
});

test('manifest 写入中途失败时，已登记素材和清单保持原样', async (t) => {
  const f = fixture(t);
  await addLogos(f, ['github']);
  const output = path.join(f.pageDir, 'assets/logos');
  const manifestFile = path.join(output, 'logos.json');
  const before = fs.readFileSync(manifestFile);
  fs.writeFileSync(path.join(output, 'github.svg'), 'existing registered SVG');
  const original = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (file, data, ...options) => {
    if (path.basename(String(file)) === 'logos.json') {
      original(file, String(data).slice(0, 10), ...options);
      throw new Error('模拟磁盘写满');
    }
    return original(file, data, ...options);
  });
  await assert.rejects(addLogos(f, ['github']), /模拟磁盘写满/);
  assert.deepEqual(fs.readFileSync(manifestFile), before);
  assert.equal(fs.readFileSync(path.join(output, 'github.svg'), 'utf8'), 'existing registered SVG');
  assert.deepEqual(fs.readdirSync(output).sort(), ['github-mono.svg', 'github.svg', 'logos.json']);
});

test('manifest 发布 rename 失败后，已发布的 SVG 允许 CLI 正常重跑', async (t) => {
  const f = fixture(t), output = path.join(f.pageDir, 'assets/logos');
  const manifestFile = path.join(output, 'logos.json');
  const original = fs.renameSync, published = [];
  const rename = t.mock.method(fs, 'renameSync', (from, to, ...options) => {
    if (to === manifestFile) {
      assert.deepEqual(published, ['github.svg', 'github-mono.svg']);
      assert.match(fs.readFileSync(path.join(output, 'github.svg'), 'utf8'), /<svg/);
      assert.equal(fs.existsSync(manifestFile), false);
      throw Object.assign(new Error('模拟 manifest 发布 rename EIO'), { code: 'EIO' });
    }
    const result = original(from, to, ...options);
    published.push(path.basename(to));
    return result;
  });
  try {
    await assert.rejects(addLogos(f, ['github']), { code: 'EIO', message: '模拟 manifest 发布 rename EIO' });
  } finally {
    rename.mock.restore();
  }
  assert.deepEqual(fs.readdirSync(output).sort(), ['github-mono.svg', 'github.svg']);
  const c = capture({ PINPOINT_REGISTRY: f.registry, PINPOINT_DATA_DIR: path.join(f.root, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' });
  assert.equal(await run(['logo', 'add', 'demo/story', 'github'], c.io), 0, c.errors.join('\n'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  for (const file of Object.values(manifest.github.files)) {
    assert.match(fs.readFileSync(path.join(f.pageDir, file), 'utf8'), /<svg/);
  }
  assert.equal(fs.existsSync(path.join(output, '.write-lock')), false);
});

test('发布后的 staging 清理失败仍解锁，CLI 报真实原因且可重跑', async (t) => {
  const f = fixture(t), output = path.join(f.pageDir, 'assets/logos');
  const original = fs.rmSync, cleanupAttempts = [];
  const cleanup = t.mock.method(fs, 'rmSync', (file, ...options) => {
    if (path.dirname(file) === output && path.basename(file).startsWith('.write-')) {
      assert.ok(fs.existsSync(path.join(output, 'github.svg')));
      assert.ok(JSON.parse(fs.readFileSync(path.join(output, 'logos.json'), 'utf8')).github);
      assert.deepEqual(fs.readdirSync(file), []);
      cleanupAttempts.push(file);
      throw Object.assign(new Error('模拟 staging 清理 EACCES'), { code: 'EACCES' });
    }
    return original(file, ...options);
  });
  const c = capture({ PINPOINT_REGISTRY: f.registry, PINPOINT_DATA_DIR: path.join(f.root, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' });
  try {
    assert.equal(await run(['logo', 'add', 'demo/story', 'github'], c.io), 1);
  } finally {
    cleanup.mock.restore();
  }
  assert.equal(cleanupAttempts.length, 1);
  assert.match(c.errors.join('\n'), /模拟 staging 清理 EACCES/);
  assert.equal(fs.existsSync(path.join(output, '.write-lock')), false);
  assert.equal(await run(['logo', 'add', 'demo/story', 'github'], c.io), 0, c.errors.join('\n'));
});

test('第二次 add 的 Fav 替换组件后，旧调用和新品牌均能实际渲染', async (t) => {
  const f = fixture(t);
  const env = { PINPOINT_REGISTRY: f.registry, PINPOINT_DATA_DIR: path.join(f.root, 'data'), PINPOINT_ORIGIN: 'http://127.0.0.1:1' };
  const add = async (brand) => {
    const c = capture(env);
    assert.equal(await run(['logo', 'add', 'demo/story', brand], c.io), 0, c.errors.join('\n'));
    const example = c.output.find(line => line.startsWith('JSX 帧和 MDX')).split('\n').slice(1).join('\n');
    fs.writeFileSync(path.join(f.pageDir, 'components/Fav.jsx'), example);
  };
  fs.mkdirSync(path.join(f.pageDir, 'components'));
  const oldFrame = "import { Fav } from './components/Fav.jsx';\nexport default function Example() { return <Fav site=\"github\" />; }\n";
  fs.writeFileSync(path.join(f.pageDir, 'example.jsx'), oldFrame);
  await add('github');
  const first = capture(env);
  assert.equal(await run(['render', 'demo/story/example', '--full'], first.io), 0, first.errors.join('\n'));
  assert.match(first.output.join('\n'), /github.svg/);
  await add('google');
  assert.equal(fs.readFileSync(path.join(f.pageDir, 'example.jsx'), 'utf8'), oldFrame);
  const oldCall = capture(env);
  assert.equal(await run(['render', 'demo/story/example', '--full'], oldCall.io), 0, oldCall.errors.join('\n'));
  assert.match(oldCall.output.join('\n'), /github.svg/);
  fs.writeFileSync(path.join(f.pageDir, 'both.jsx'), "import { Fav } from './components/Fav.jsx';\nexport default function Both() { return <div><Fav site=\"github\" /><Fav site=\"google\" /></div>; }\n");
  const both = capture(env);
  assert.equal(await run(['render', 'demo/story/both', '--full'], both.io), 0, both.errors.join('\n'));
  assert.match(both.output.join('\n'), /github.svg/);
  assert.match(both.output.join('\n'), /google.svg/);
  assert.equal((both.output.join('\n').match(/<img /g) || []).length, 2);
});
