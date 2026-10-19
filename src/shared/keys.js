// 键盘判断的唯一一份（C2，替掉 board-nav / ann-bridge / live-cards / share-runtime
// 各自的 isTypingTarget 与散落的 IME 守卫）。随 annotate bundle 内联进 /annotate.js，
// 工作台与站点直接 import；保持纯函数、不碰 DOM。

/** 焦点在文本输入里，快捷键（空格、A/S、Esc 关层）要让位。
    select 一并算打字：空格在 select 上是开合下拉，不是画布平移 —— 旧实现
    stage 判「非打字」（按空格会平移画布）、annotate 判「打字」，两处不一致，
    统一成「打字中」（r2 D6/I9）。 */
export function isTypingTarget(el) {
  if (!el || !el.closest) return false;
  if (el.closest('input, textarea, select')) return true;
  var ce = el.closest('[contenteditable]');
  return !!(ce && ce.isContentEditable);
}

/** 输入法组字中的按键（Safari 组字结束那一下 keyCode 是 229）：
    回车、Esc、空格都归输入法，不触发页面快捷键。 */
export function isComposingKey(e) {
  return !!(e.isComposing || e.keyCode === 229);
}
