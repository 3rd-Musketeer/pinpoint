// 工作台标注列表的 agent 备注 hover 卡（AnnPopover.jsx）定位。
// 纯函数：给行矩形、卡实测尺寸与视口，返回 position:fixed 的 left/top。
// 规则与评论卡同款（annotate.js updateCanvasBubble）：贴行右侧、放不下翻
// 左侧，最后两轴收进视口安全边距 —— 竖直方向行顶上提 4px 对齐卡顶。

export var NOTE_CARD_W = 186;      // 评论卡宽（2026-09-04 评审板 H1）
export var NOTE_CARD_GAP = 13;     // 与评论卡贴锚间距同值
export var NOTE_CARD_MARGIN = 12;  // 视口安全边距（评论卡 BUBBLE_MARGIN 同值）

export function noteCardPosition(anchor, width, height, vw, vh) {
  const m = NOTE_CARD_MARGIN;
  let left = anchor.right + NOTE_CARD_GAP;
  if (left + width > vw - m) left = anchor.left - width - NOTE_CARD_GAP;
  left = Math.max(m, Math.min(left, vw - width - m));
  const top = Math.max(m, Math.min(anchor.top - 4, vh - height - m));
  return { left: Math.round(left), top: Math.round(top) };
}
