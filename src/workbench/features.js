// 暂时收起的 UI 功能开关：代码、测试、DOM 契约都留着，只是不显示、不响应。
// 要恢复某项，把它改成 true（e2e 里按同一个值自动跳过 / 启用对应用例）。
// 只收“owner 暂时不用、以后可能要回来”的功能；永久退役的走 ADR，不放这里。
export const FEATURES = Object.freeze({
  // 底部横条里的 ‹ 4 / 12 › Section 循环钮 + Section Navigator 面板 + M 快捷键。
  sectionNav: false,
  // 底部横条里的地图钮 + Canvas map 缩略图面板。
  minimap: false,
});
