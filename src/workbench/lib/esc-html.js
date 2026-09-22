/**
 * Escape a value for interpolation into HTML text or double-quoted attributes.
 * Shared by the workbench chrome, the annotate bubble (inlined into
 * /annotate.js) and the offline export bake. `'` → `&#39;` 一并转（单引号
 * 属性也安全）；null/undefined 落空串而不是字符串化的 'null'。
 */
export function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
