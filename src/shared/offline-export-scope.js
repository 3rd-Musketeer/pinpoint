/**
 * 离线可交互 HTML 导出（ADR 0033）能导哪些页：registry 的 dir 条目、board 是 ios、页 id 不带 `_`
 * （文章画布页 `<project>_<article>` 不导）。构建器（src/server/lib/offline-page-builder.js）按它拒绝，
 * 工作台按它决定横条上显不显示“导出”钮，两边同一个口径。纯函数，不碰 DOM。
 */
export const OFFLINE_EXPORT_PAGE_ID = /^[a-z0-9][a-z0-9-]*$/;

/** kind / board 是 registry 条目上的字段。 */
export function offlineExportSupported(pageId, { kind, board } = {}) {
  return OFFLINE_EXPORT_PAGE_ID.test(String(pageId || '')) && kind === 'dir' && board === 'ios';
}
