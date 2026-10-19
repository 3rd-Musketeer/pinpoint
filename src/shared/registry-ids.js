/**
 * Registry id rules shared by the node side (registry.js, the CLI) and the
 * browser (project-ids.js). Pure: no node deps.
 */
export const ENTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
// 页 id（2026-08-16f 阶段 8）：本地 manifest 页（preview-contracts 的 identifier，
// 默认档 = project-ids.js SCREEN_ID_PATTERN，与该模式同形）、registry 条目 id 与
// 文章画布页 id `<project>_<article>`（project-ids.js）都落在该模式内。屏 / 图 / 节的
// id 规则不在这里，在 project-ids.js（S1 起不再拿 PAGE_ID_PATTERN 校验屏 id）。
export const PAGE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/** 名称 → id 基材：小写、非字母数字折叠成 -、去首尾 -。 */
export function slugify(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
