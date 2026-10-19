/**
 * Escape a value for interpolation into HTML text or double-quoted attributes.
 * 全仓一份（原 workbench/lib/esc-html.js，2026-10-19 S1 收进 shared）：工作台外壳、
 * 标注气泡与 composer（内联进 /annotate.js）、服务端 frame-doc / 导出、article-proxy
 * 与文章站点 client 都用它。`'` → `&#39;` 一并转（单引号属性也安全）；
 * null/undefined 落空串而不是字符串化的 'null'。
 */
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
