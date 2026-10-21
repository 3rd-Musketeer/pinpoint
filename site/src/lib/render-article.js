/**
 * 文章正文的渲染入口（文章页用）。Astro 开发服务器里一篇刚写进内容库的文章，有一小段时间
 * 内容库已经有它、渲染模块表（`astro:content-module-imports`，.astro/content-modules.mjs）
 * 还没有：内容库写盘后 Astro 直接让它失效，模块表只靠文件 watcher 刷新，满载时晚得更多。
 * 这段时间里 `render(entry)` 抛 UnknownContentCollectionError，页面是 500
 * （2026-10-15，docs/debugging.md）。这里把这种情况认出来交给页面回 503“内容同步中”，
 * 和“站点启动中”一样让浏览器自己刷新、让 ppnt shot 接着等；别的渲染错误照旧抛。
 *
 * 模块已登记、但这篇的源文件已经被写坏（loader 的 loadError 条目还没接上）时，渲染走的
 * mdx 转换会重读源文件、抛带文件路径的 YAMLException。只认路径归属到这篇（entry.data.file）
 * 的解析错，转成与 loader catch 分支（loaders.js）同形的错误条 `file: message` 交给页面亮出来；
 * 他篇/未知/无归属的错误照旧抛。→ { syncing: false, rendered: null, loadError }。
 *
 * deps.render：astro:content 的 render；deps.moduleImports()：→ 模块表 Map（键是 entry.filePath）。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 两个路径是不是同一实物的可信名字：先字面比对；macOS 上 /var 与 /private/var 这类 symlink
 *  别名（loaders.js watchAll 的 expand 同款坑）再各做一次 realpath。任一路径不存在或不是
 *  绝对路径（错误 id 带 query 等形态）就不认——归属判定宁可漏认不可误认。 */
function sameFile(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !path.isAbsolute(a) || !path.isAbsolute(b)) return false;
  if (a === b) return true;
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return false;
  }
}

/** 已识别且属于这篇自己的 frontmatter/YAML 解析错 → 与 loader loadError 同形的错误条；其余 null。
 * 依据是错误自带的文件身份（mdx 的 safeParseFrontmatter 给 YAMLException 补 id 与 loc.file），
 * 不是 name/message——邻篇/组件抛的同名错不能当这篇的。 */
function articleLoadError(entry, error) {
  if (!error || error.name !== 'YAMLException' || typeof error.message !== 'string') return null;
  const file = entry?.data?.file;
  if (typeof file !== 'string') return null;
  return [error.id, error.loc?.file].some((p) => sameFile(p, file)) ? `${file}: ${error.message}` : null;
}

export async function renderArticle(entry, { render, moduleImports }) {
  try {
    return { syncing: false, rendered: await render(entry) };
  } catch (error) {
    if (!entry?.deferredRender || !entry.filePath) throw error;
    let modules;
    try {
      modules = await moduleImports();
    } catch {
      throw error;
    }
    if (modules && typeof modules.has === 'function' && !modules.has(entry.filePath)) return { syncing: true };
    const loadError = articleLoadError(entry, error);
    if (loadError) return { syncing: false, rendered: null, loadError };
    throw error;
  }
}

/** 503 页：正文还在同步。每秒自动刷新；Retry-After 给脚本（ppnt shot 把 503 当成“再等等”）。 */
export function syncingResponse(title) {
  const safe = String(title || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="refresh" content="1">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe}</title>
<style>:root{color-scheme:light dark}body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}main{max-width:640px;margin:18vh auto 0;padding:0 16px}</style>
</head><body><main data-site-state="syncing"><h1>内容同步中</h1><p>这篇文章刚写好，站点还在载入它，页面会自动刷新。</p></main></body></html>
`;
  return new Response(html, {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '1' },
  });
}
