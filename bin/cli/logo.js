import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { createRequire } from 'node:module';
import { guardParse, reportUsageError } from './args.js';
import { ioOf, REPO_ROOT, CliError } from './core.js';
import { resolveAddress } from './address.js';
import { resolveRegistryPath } from './registry.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { resolveContainedPath } from '../../src/server/lib/servable-file.js';

const require = createRequire(import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(require.resolve(name), 'utf8'));
const sets = { color: read('@iconify-json/logos/icons.json'), mono: read('@iconify-json/simple-icons/icons.json') };
// 全量品牌色表的来源与更新方式见 scripts/update-logo-colors.mjs。
const colors = read('./logo-colors.json');
// 服务名称与图标集的拼写不同；不把相近品牌当作同一品牌。
const aliases = { google: 'google-icon', gmail: 'google-gmail', gcal: 'google-calendar', calendar: 'google-calendar', github: 'github-icon', googlecalendar: 'google-calendar', openai: 'openai-icon', claude: 'claude-icon', gemini: 'google-gemini-icon', notion: 'notion-icon', slack: 'slack-icon', grok: 'grok-icon', cursor: 'cursor-icon', eventbrite: 'eventbrite-icon' };
const monoAliases = { 'google-gmail': 'gmail', 'google-calendar': 'googlecalendar', 'google-gemini': 'googlegemini' };
const key = (s) => String(s).trim().toLowerCase();
const compact = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
const indexes = new Map(Object.values(sets).map((set) => {
  const names = [...Object.keys(set.icons), ...Object.keys(set.aliases || {})];
  const compactNames = new Map();
  for (const name of names) if (!compactNames.has(compact(name))) compactNames.set(compact(name), name);
  return [set, { names, exact: new Set(names), compact: compactNames }];
}));
const names = (set) => indexes.get(set).names;
const findName = (set, name) => indexes.get(set).exact.has(name) ? name : indexes.get(set).compact.get(compact(name));
function canonicalName(set, name) {
  while (set.aliases?.[name]) name = set.aliases[name].parent;
  return name;
}

export function logoVariants(name) {
  const raw = key(name);
  const colorName = findName(sets.color, aliases[raw] || raw) || findName(sets.color, `${raw}-icon`);
  const base = (aliases[raw] || raw).replace(/-icon$/, '');
  const monoName = findName(sets.mono, monoAliases[base] || base);
  return { color: colorName || null, mono: monoName || null, hex: colors[canonicalName(sets.mono, monoName)] || null };
}

export function searchLogos(term) {
  const q = key(term), normalized = compact(q);
  return [...new Set([...names(sets.color), ...names(sets.mono)])]
    .filter((n) => n.includes(q) || compact(n).includes(normalized))
    .sort().map((name) => ({ name, ...logoVariants(name) }));
}

function iconSvg(set, name) {
  const icon = set.icons[canonicalName(set, name)];
  if (!icon) throw new Error(`图标不存在：${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width || set.width || 16} ${icon.height || set.height || 16}">${icon.body}</svg>\n`;
}

/** 按实际边界居中，再按白底对比度面积补留白；缩放限于 80%~100%。 */
export function normalizeLogoSvg(svg, color = '#000') {
  const box = new Resvg(svg, { font: { loadSystemFonts: false } }).getBBox();
  if (!box || !(box.width > 0) || !(box.height > 0)) throw new Error('Logo SVG 没有可见图形边界');
  let side = Math.max(box.width, box.height);
  const tightBox = [box.x + box.width / 2 - side / 2, box.y + box.height / 2 - side / 2, side, side].join(' ');
  const preview = svg.replace(/viewBox="[^"]*"/, `viewBox="${tightBox}"`).replace(/currentColor/g, color);
  const { pixels, width, height } = new Resvg(preview, { fitTo: { mode: 'width', value: 256 }, font: { loadSystemFonts: false } }).render();
  let area = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    area += pixels[i + 3] / 255 * (1 - (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255);
  }
  const scale = Math.max(0.8, Math.min(1, Math.sqrt(0.25 / (area / (width * height)))));
  side /= scale;
  const viewBox = [box.x + box.width / 2 - side / 2, box.y + box.height / 2 - side / 2, side, side]
    .map((n) => Number(n.toFixed(6))).join(' ');
  return svg.replace(/viewBox="[^"]*"/, `viewBox="${viewBox}"`);
}

const xml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
export function placeholderSvg(name) {
  const label = key(name).normalize('NFKC');
  let hash = 2166136261;
  for (const c of label) hash = Math.imul(hash ^ c.codePointAt(0), 16777619) >>> 0;
  const hue = hash % 360;
  const initial = [...label][0]?.toUpperCase() || '?';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 48% 34%)"/><text x="32" y="33" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="system-ui,sans-serif" font-size="32" font-weight="600">${xml(initial)}</text></svg>\n`;
}

async function appIcon(name, country, fetchFn) {
  const url = new URL('https://itunes.apple.com/search');
  for (const [k, v] of Object.entries({ term: name, entity: 'software', limit: '1', country })) url.searchParams.set(k, v);
  const response = await fetchFn(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`App Store 查询失败：HTTP ${response.status}`);
  const app = (await response.json()).results?.[0];
  if (!app?.artworkUrl512) throw new Error(`App Store 找不到 ${name}（${country}）`);
  const appNames = { 'google-gmail': ['gmail'], gcal: ['googlecalendar'], ctrip: ['ctrip', '携程'], wechat: ['wechat', '微信'], feishu: ['feishu', '飞书', 'lark'], dingtalk: ['dingtalk', '钉钉'], douyin: ['douyin', '抖音'] };
  const expected = appNames[key(name)] || [name];
  if (!app.trackName || !expected.some((n) => compact(key(app.trackName)).includes(compact(key(n))))) {
    throw new Error(`App Store 首条结果“${app.trackName || '未命名'}”与 ${name} 不匹配；请换搜索词，或不带 --app 使用 --placeholder`);
  }
  // Apple 的 artworkUrl512 也会返回 JPEG；同一 artwork 的缩略图端点可指定 PNG。
  const artwork = new URL(app.artworkUrl512);
  if (artwork.hostname.endsWith('.mzstatic.com')) artwork.pathname = artwork.pathname.replace(/\.(?:jpg|jpeg)$/i, '.png');
  const image = await fetchFn(artwork.href, { signal: AbortSignal.timeout(20000) });
  if (!image.ok) throw new Error(`App 图标下载失败：HTTP ${image.status}`);
  const png = Buffer.from(await image.arrayBuffer());
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('App 图标不是 PNG');
  return { png, source: { trackId: app.trackId, trackName: app.trackName, url: artwork.href, artworkUrl512: app.artworkUrl512, country } };
}

export async function addLogos(target, requested, { app = false, country = 'us', placeholder = false, fetchFn = fetch } = {}) {
  if (!/^[a-z]{2}$/i.test(country)) throw new CliError('country 必须是两位国家代码，如 us、cn');
  const output = path.join(target.pageDir, 'assets/logos');
  const contained = (file) => {
    // 输出尚未存在时，检查最近的现存祖先；symlink 仍按真实落点检查。
    let ancestor = file;
    while (true) {
      try { fs.lstatSync(ancestor); break; } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        ancestor = path.dirname(ancestor);
      }
    }
    const resolved = resolveContainedPath(target.pageDir, path.relative(target.pageDir, ancestor));
    if (resolved.reason) throw new Error(`素材路径越出文章目录：${file}`);
  };
  contained(output);
  const manifestFile = path.join(output, 'logos.json');
  contained(manifestFile);
  const results = [];
  for (const name of requested) {
    const slug = key(name).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    if (!slug || ['__proto__', 'constructor', 'prototype'].includes(slug)) throw new CliError(`品牌名称无效：${name}`);
    const variants = logoVariants(name);
    const files = {};
    const pending = new Map();
    const write = (suffix, data) => {
      const file = `${slug}${suffix}`;
      pending.set(file, data);
      return `assets/logos/${file}`;
    };
    if (variants.color) files.color = write('.svg', normalizeLogoSvg(iconSvg(sets.color, variants.color)));
    if (variants.mono) files.mono = write('-mono.svg', normalizeLogoSvg(iconSvg(sets.mono, variants.mono), variants.hex || '#000'));
    let store;
    if (app) {
      const result = await appIcon(name, country, fetchFn);
      files.app = write('-app.png', result.png);
      store = result.source;
    }
    if (!Object.keys(files).length) {
      if (!placeholder) throw new CliError(`找不到 ${name}；用 ppnt logo search 查名字，或加 --app / --placeholder`);
      files.placeholder = write('.svg', placeholderSvg(name));
    }
    const row = { name, slug, hex: variants.hex, files, sources: { ...(variants.color ? { color: `logos:${variants.color}` } : {}), ...(variants.mono ? { mono: `simple-icons:${variants.mono}` } : {}), ...(store ? { app: store } : {}) } };
    commitLogo(output, row, pending, contained);
    results.push(row);
  }
  return results;
}

/** 下载和 SVG 计算完成后再写；锁内读取最新清单，文件逐个原子替换。 */
function commitLogo(output, row, pending, contained) {
  contained(output);
  fs.mkdirSync(output, { recursive: true });
  const lock = path.join(output, '.write-lock');
  try { fs.mkdirSync(lock); } catch (error) {
    if (error.code === 'EEXIST') throw new Error('另一条 logo 命令正在写入；稍后重试（中断遗留的 assets/logos/.write-lock 需手动移除）');
    throw error;
  }
  let staging;
  try {
    const manifestFile = path.join(output, 'logos.json');
    contained(manifestFile);
    const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
    const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
    if (!record(manifest) || Object.values(manifest).some((row) => !record(row) || typeof row.name !== 'string' || !record(row.files) || !record(row.sources))) throw new Error('Logo manifest 必须是品牌记录对象');
    const previous = manifest[row.slug];
    if (previous && key(previous.name).normalize('NFKC') !== key(row.name).normalize('NFKC')) throw new CliError(`品牌文件名冲突：${previous.name} / ${row.name}`);
    // pending 只含本 slug 的固定命名产物，未登记的中断产物也允许重跑覆盖。
    for (const file of [...pending.keys(), 'logos.json']) {
      const destination = path.join(output, file);
      contained(destination);
      if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`拒绝覆盖非普通文件或 symlink：${destination}`);
      }
    }
    row.files = { ...previous?.files, ...row.files };
    row.sources = { ...previous?.sources, ...row.sources };
    manifest[row.slug] = row;
    pending.set('logos.json', JSON.stringify(manifest, null, 2) + '\n');
    staging = fs.mkdtempSync(path.join(output, '.write-'));
    for (const [file, data] of pending) fs.writeFileSync(path.join(staging, file), data);
    for (const file of pending.keys()) fs.renameSync(path.join(staging, file), path.join(output, file));
  } finally {
    try {
      if (staging) fs.rmSync(staging, { recursive: true, force: true });
    } finally {
      fs.rmdirSync(lock);
    }
  }
}

export async function runLogo(argv, io = {}) {
  const { out, err, env } = ioOf(io);
  const parsed = guardParse(argv, { err, out });
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  try {
    const [action, targetRef, ...requested] = parsed.items;
    if (action === 'search') {
      if (!targetRef || requested.length || parsed.flags.app || parsed.flags.country || parsed.flags.placeholder) throw new CliError('用法：ppnt logo search <词>');
      const results = searchLogos(targetRef);
      out(results.length ? results.map((r) => `${r.name}  彩色:${r.color || '—'}  单色:${r.mono || '—'}${r.hex ? `  ${r.hex}` : ''}`).join('\n') : '没有找到 logo');
      return 0;
    }
    if (action !== 'add' || !targetRef || !requested.length) throw new CliError('用法：ppnt logo add <文章地址> <品牌>... [--app [--country cn]] [--placeholder]');
    if (parsed.flags.country && !parsed.flags.app) throw new CliError('--country 和 --app 一起使用');
    const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env), log: err });
    const address = resolveAddress(targetRef, { registry });
    if (address?.kind !== 'article') throw new CliError(`找不到文章：${targetRef}`);
    const rows = await addLogos(address.target, requested, { app: parsed.flags.app, country: parsed.flags.country, placeholder: parsed.flags.placeholder, fetchFn: io.fetchFn });
    for (const row of rows) {
      out(`${row.name}${row.sources.app ? `（App Store：${row.sources.app.trackName}，${row.sources.app.trackId}）` : ''}：${Object.values(row.files).join('、')}；品牌色 ${row.hex || '未知'}（来源见 assets/logos/logos.json）`);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(address.target.pageDir, 'assets/logos/logos.json'), 'utf8'));
    const assets = Object.fromEntries(Object.entries(manifest).map(([slug, row]) => {
      const kind = ['app', 'color', 'placeholder', 'mono'].find((kind) => row.files[kind]);
      return [slug, { src: address.target.urlBase + row.files[kind], kind, color: row.hex || '#000' }];
    }));
    out(`JSX 帧和 MDX（本篇只保留一个 Fav，调用时只改 site 和 size）：
export function Fav({ site, size = 24 }) {
  const assets = ${JSON.stringify(assets, null, 2)};
  const logo = assets[site];
  const full = logo.kind === 'app' || logo.kind === 'placeholder';
  const inner = full ? size : size * 0.72;
  const style = { display: 'block', width: inner + 'px', height: inner + 'px', flex: 'none', objectFit: 'contain' };
  return <span data-brand={site} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle', flex: 'none', boxSizing: 'border-box', width: size + 'px', height: size + 'px', borderRadius: '25%', overflow: 'hidden', background: '#fff', border: full ? '0' : '0.5px solid rgba(0,0,0,.16)' }}>
    {logo.kind === 'mono' ? <span style={{ ...style, backgroundColor: logo.color, mask: 'url(' + logo.src + ') center / contain no-repeat', WebkitMask: 'url(' + logo.src + ') center / contain no-repeat' }} /> : <img src={logo.src} alt="" style={style} />}
  </span>;
}`);
    return 0;
  } catch (error) {
    if (!(error instanceof CliError)) err(`错误：${error.message}`);
    return error instanceof CliError ? reportUsageError('logo', error.message, err) : 1;
  }
}
