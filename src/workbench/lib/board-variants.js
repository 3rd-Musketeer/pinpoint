// 变体组（2026-10-10 grilling）：screen 条目写 `variants: [{ id, title? }, …]` 时，它是一个
// 变体组 —— 同一个关键帧的几种画法。每个变体仍是独立屏（自己的源文件、自己的 id、标注挂在它上面），
// 组本身没有文件，id 只用来给组命名、做引用（B11 / 裸组 id）。
//
// 本模块把板"摊平"：组条目换成它的变体，每个变体带 `variantOf`（组 id）与 `groupTitle`，其余全是普通屏。
// 编译、装载、导出、截图这些只认屏的消费端因此不用改；编号与引用在 board-refs.js 里按 `variantOf` 归组。
// 纯函数、DOM-free，宽松：坏形状原样放过，严格校验归 preview-contracts.validateBoard。

/** 条目是不是变体组：对象且 variants 是数组。 */
export function isVariantGroup(entry) {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry) && Array.isArray(entry.variants);
}

// 组上写的壳与角色由变体继承；src / comp / props 属于单屏，不继承。
const INHERITED = ['shell', 'role'];

function expandEntry(entry) {
  if (!isVariantGroup(entry)) return [entry];
  const groupId = typeof entry.id === 'string' ? entry.id : '';
  const groupTitle = typeof entry.title === 'string' ? entry.title : '';
  return entry.variants.map(function (variant) {
    const own = typeof variant === 'string' ? { id: variant } : variant;
    if (!own || typeof own !== 'object') return variant;
    const out = {};
    INHERITED.forEach(function (key) { if (entry[key] != null) out[key] = entry[key]; });
    return Object.assign(out, own, { variantOf: groupId, groupTitle: groupTitle });
  });
}

/** board → 摊平后的 board；没有变体组时返回原对象（引用不变），摊平过的板再摊平是空操作。 */
export function expandVariants(board) {
  if (!board || !Array.isArray(board.sections)) return board;
  const has = board.sections.some(function (sec) {
    return sec && Array.isArray(sec.screens) && sec.screens.some(isVariantGroup);
  });
  if (!has) return board;
  return Object.assign({}, board, {
    sections: board.sections.map(function (sec) {
      if (!sec || !Array.isArray(sec.screens) || !sec.screens.some(isVariantGroup)) return sec;
      return Object.assign({}, sec, { screens: [].concat.apply([], sec.screens.map(expandEntry)) });
    })
  });
}
