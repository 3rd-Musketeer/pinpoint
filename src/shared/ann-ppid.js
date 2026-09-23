/**
 * ppId 锚点的解析辅件（决定 #15）：attribute 选择器拼装、目标文本归一、
 * 多命中按文本择近。
 *
 * 两端共用：client（src/client/annotate.js，serve 时内联进 /annotate.js）拿
 * DOM 元素列表择近；CLI（src/server/lib/ann-query.js）拿 dist HTML 解析树的
 * 节点择近。候选侧的文本由调用方提取（client 走 excerpt()，服务端剥标签），
 * 本模块只做纯比较 —— 与 lib/ 各模块同例，DOM-free，node --test 直测。
 */

/** ppId → attribute 选择器。引号串里的属性值只要求转义 `"` 与 `\`（文件名带
 * 空白也合法）；空值返回 null —— 调用方据此回落 cssPath。 */
export function ppIdAttrSelector(ppId) {
  const value = String(ppId || '');
  if (!value) return null;
  return `[data-pp-id="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/** 目标文本归一：与 client excerpt() 同规则 —— 空白折一、去首尾、截 120。 */
export function normalizeTargetText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * 文本接近度（越大越近）：归一后相等 = 3；一方包含另一方 = 2；否则公共
 * 前缀占长串的比例。双方都空 = 1（无从分辨，交给文档序）。
 */
export function targetTextAffinity(stored, candidate) {
  const a = normalizeTargetText(stored);
  const b = normalizeTargetText(candidate);
  if (a === b) return a ? 3 : 1;
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 2;
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n / Math.max(a.length, b.length);
}

/**
 * 同一 ppId 的多个命中里挑文本最接近 storedText 的那个（决定 #15：同行多
 * 实例靠文本分）。items 是带 text 字段的候选（元素 / 树节点均可）；严格大于
 * 才换人 —— 平手留在文档序第一个，保证确定性。空列表返回 null。
 */
export function pickByTargetText(items, storedText) {
  let best = null;
  let bestScore = -1;
  for (const item of items) {
    const score = targetTextAffinity(storedText, item && item.text);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}
