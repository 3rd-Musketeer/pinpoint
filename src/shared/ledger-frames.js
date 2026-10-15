/** 一本 HTML 账本只保留一份行；screenId 用于右栏定位，screenIds 列出所有引用帧供卡片计数。
 * 已有 screenId 的画布行保留原归属。纯函数，文章卡片与注入客户端共用。 */
export function ledgerFrameRows(doc, frames) {
  const ids = [...new Set((frames || []).filter(Boolean))];
  const rows = Array.isArray(doc?.annotations) ? doc.annotations : [];
  return rows.map((row) => row && !row.screenId && ids.length
    ? { ...row, screenId: ids[0], screenIds: ids }
    : row);
}
