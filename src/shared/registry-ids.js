/**
 * Registry id rules shared by the node side (registry.js, the CLI) and the
 * browser (workbench folder creation). Pure: no node deps.
 */
export const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// 文件夹 id 与条目 id 同一套模式（2026-09-04 决定 5a）：一层分组，不嵌套，
// 两个命名空间各自独立——`folder` 字段只引用 folders[] 里的 id。
export const FOLDER_ID_PATTERN = ENTRY_ID_PATTERN;

/** 名称 → id 基材：小写、非字母数字折叠成 -、去首尾 -。 */
export function slugify(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
