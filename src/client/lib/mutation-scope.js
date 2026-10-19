// 一条 DOM 变更记录的失效范围（perf 审计 K1 第三刀）：返回记录自身 = 只失效它
// 所在的帧（schedule 按 .wb-screen 局部刷新），返回 null = 整层重绘（renderAll）。
// depsOf 惰性给出账本选择器的依赖标记 { relational, global }（遍历 marks，短路时
// 不付这笔）。schedule.js 的 MutationObserver 逐条记录问这里。
//
// 属性变更一律按所在帧刷新，不升级全局：同值 class 反复重写（工作台的选中高亮
// f2d7639 之前就每轮这么写）最多喂出所在帧的一次局部刷新，喂不出「重绘 → notify
// → 快照 → 又一次同值写」的自持循环（2026-10-19 性能审计 K1，owner 在画布上打字
// 卡）。跨帧重新命中交给下一次整层重绘 —— 全局或关系选择器的归属是属性，帧 A 的
// class / style 变更可以改一条当前落在帧 B 的标注命中谁，这次局部刷新盖不到帧 B。
// 结构变更（childList）与样式表变更仍按依赖升级：节点挪动会换帧，style / link 的
// 变化能到达别的帧；文字变更不因全局选择器升级（原行为，保留）。
export function mutationScope(record, depsOf) {
  var node = record.target.nodeType === 1 ? record.target : record.target.parentElement;
  var broad = node && node.closest('style, link');
  if (!broad && record.type !== 'attributes') {
    var deps = depsOf();
    broad = deps.relational || (record.type !== 'characterData' && record.attributeName !== 'style' && deps.global);
  }
  return broad ? null : record;
}
