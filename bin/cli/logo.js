import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseArgs, guardParse } from './args.js';
import { ioOf, REPO_ROOT } from './core.js';
import { resolveAddress } from './address.js';
import { resolveRegistryPath } from './registry.js';
import { loadRegistry } from '../../src/server/lib/registry.js';
import { resolveContainedPath } from '../../src/server/lib/servable-file.js';

const require = createRequire(import.meta.url);
const read = (name) => JSON.parse(fs.readFileSync(require.resolve(name), 'utf8'));
const sets = { color: read('@iconify-json/logos/icons.json'), mono: read('@iconify-json/simple-icons/icons.json') };
const brands = read('simple-icons/icons.json');
const colors = new Map(brands.map((b) => [b.slug, `#${b.hex}`]));
// 服务名称与图标集的拼写不同；不把相近品牌当作同一品牌。
const aliases = { gmail: 'google-gmail', gcal: 'google-calendar', calendar: 'google-calendar', github: 'github-icon', googlecalendar: 'google-calendar', openai: 'openai-icon', claude: 'claude-icon', gemini: 'google-gemini-icon', notion: 'notion-icon', slack: 'slack-icon', grok: 'grok-icon', cursor: 'cursor-icon', eventbrite: 'eventbrite-icon' };
const monoAliases = { 'google-gmail': 'gmail', 'google-calendar': 'googlecalendar', 'google-gemini': 'googlegemini' };
const key = (s) => String(s).trim().toLowerCase();
const compact = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
const names = (set) => [...Object.keys(set.icons), ...Object.keys(set.aliases || {})];

function findName(set, name) {
  return names(set).find((n) => n === name) || names(set).find((n) => compact(n) === compact(name));
}

export function logoVariants(name) {
  const raw = key(name);
  const colorName = findName(sets.color, aliases[raw] || raw) || findName(sets.color, `${raw}-icon`);
  const base = (aliases[raw] || raw).replace(/-icon$/, '');
  const monoName = findName(sets.mono, monoAliases[base] || base);
  return { color: colorName || null, mono: monoName || null, hex: colors.get(monoName) || null };
}

export function searchLogos(term) {
  const q = key(term);
  return [...new Set([...names(sets.color), ...names(sets.mono)])]
    .filter((n) => n.includes(q) || compact(n).includes(compact(q)))
    .sort().map((name) => ({ name, ...logoVariants(name) }));
}

function iconSvg(set, name) {
  let icon = set.icons[name];
  const alias = set.aliases?.[name];
  if (!icon && alias) {
    // Iconify alias 元数据覆盖 parent 的尺寸、旋转和翻转。
    const parent = iconSvg(set, alias.parent);
    let transform = '';
    if (alias.hFlip) transform += ' translate(1 0) scale(-1 1)';
    if (alias.vFlip) transform += ' translate(0 1) scale(1 -1)';
    if (alias.rotate) transform += ` rotate(${alias.rotate * 90} .5 .5)`;
    if (!transform) return parent;
    const [, width, height, body] = parent.match(/viewBox="0 0 (\d+) (\d+)"[^>]*>([\s\S]*)<\/svg>/);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><g transform="scale(${width} ${height})${transform}"><g transform="scale(${1 / width} ${1 / height})">${body}</g></g></svg>`;
  }
  if (!icon) throw new Error(`图标不存在：${name}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width || set.width || 16} ${icon.height || set.height || 16}">${icon.body}</svg>\n`;
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
  const image = await fetchFn(app.artworkUrl512, { signal: AbortSignal.timeout(20000) });
  if (!image.ok) throw new Error(`App 图标下载失败：HTTP ${image.status}`);
  const png = Buffer.from(await image.arrayBuffer());
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('App 图标不是 PNG');
  return { png, source: { trackId: app.trackId, trackName: app.trackName, url: app.artworkUrl512, country } };
}

export async function addLogos(target, requested, { app = false, country = 'us', placeholder = false, fetchFn = fetch } = {}) {
  if (!/^[a-z]{2}$/i.test(country)) throw new Error('country 必须是两位国家代码，如 us、cn');
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
  const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
  const results = [];
  for (const name of requested) {
    const slug = key(name).normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
    if (!slug || ['__proto__', 'constructor', 'prototype'].includes(slug)) throw new Error(`品牌名称无效：${name}`);
    const variants = logoVariants(name);
    const files = {};
    const write = (suffix, data) => {
      const file = `${slug}${suffix}`;
      contained(path.join(output, file));
      fs.mkdirSync(output, { recursive: true });
      fs.writeFileSync(path.join(output, file), data);
      return `assets/logos/${file}`;
    };
    if (variants.color) files.color = write('.svg', iconSvg(sets.color, variants.color));
    if (variants.mono) files.mono = write('-mono.svg', iconSvg(sets.mono, variants.mono));
    let store;
    if (app) {
      const result = await appIcon(name, country, fetchFn);
      files.app = write('-app.png', result.png);
      store = result.source;
    }
    if (!Object.keys(files).length) {
      if (!placeholder) throw new Error(`找不到 ${name}；用 ppnt logo search 查名字，或加 --app / --placeholder`);
      files.placeholder = write('.svg', placeholderSvg(name));
    }
    const row = { name, slug, hex: variants.hex, files, sources: { ...(variants.color ? { color: `logos:${variants.color}` } : {}), ...(variants.mono ? { mono: `simple-icons:${variants.mono}` } : {}), ...(store ? { app: store } : {}) } };
    manifest[slug] = row;
    fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    results.push(row);
  }
  return results;
}

export async function runLogo(argv, io = {}) {
  const { out, err, env } = ioOf(io);
  const parsed = guardParse(argv, { err, out });
  if (typeof parsed === 'number') return parsed;
  if (parsed.help) return 0;
  try {
    const [action, targetRef, ...requested] = parsed.items;
    if (action === 'search') {
      if (!targetRef || requested.length || Object.keys(parsed.flags).length) throw new Error('用法：ppnt logo search <词>');
      const results = searchLogos(targetRef);
      out(results.length ? results.map((r) => `${r.name}  彩色:${r.color || '—'}  单色:${r.mono || '—'}${r.hex ? `  ${r.hex}` : ''}`).join('\n') : '没有找到 logo');
      return 0;
    }
    if (action !== 'add' || !targetRef || !requested.length) throw new Error('用法：ppnt logo add <文章地址> <品牌>... [--app [--country cn]] [--placeholder]');
    if (parsed.flags.country && !parsed.flags.app) throw new Error('--country 和 --app 一起使用');
    const registry = loadRegistry({ root: REPO_ROOT, path: resolveRegistryPath(parsed.flags, env), log: err });
    const address = resolveAddress(targetRef, { registry });
    if (address?.kind !== 'article') throw new Error(`找不到文章：${targetRef}`);
    const rows = await addLogos(address.target, requested, { app: parsed.flags.app, country: parsed.flags.country, placeholder: parsed.flags.placeholder, fetchFn: io.fetchFn });
    for (const row of rows) {
      out(`${row.name}：${Object.values(row.files).join('、')}；品牌色 ${row.hex || '未知'}（来源见 assets/logos/logos.json）`);
      const src = `${address.target.urlBase}${row.files.app || row.files.color || row.files.placeholder || row.files.mono}`;
      out(`JSX 帧和 MDX：<img src="${src}" alt="${xml(row.name)}" width="24" height="24" style={{ objectFit: 'contain'${row.files.app ? ", borderRadius: '6px'" : ''} }} />`);
      if (row.files.mono) out(`单色白（JSX 帧和 MDX）：<span role="img" aria-label="${xml(row.name)}" style={{ display: 'inline-block', width: '24px', height: '24px', backgroundColor: 'white', mask: 'url(${address.target.urlBase}${row.files.mono}) center / contain no-repeat', WebkitMask: 'url(${address.target.urlBase}${row.files.mono}) center / contain no-repeat' }} />`);
    }
    return 0;
  } catch (error) {
    err(`错误：${error.message}`);
    return 2;
  }
}
