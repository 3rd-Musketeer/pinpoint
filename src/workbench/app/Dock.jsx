// 按需显示标注列表；Esc 关闭列表或清除画布选择。
// 列表是工作台弹层栈里的一层（C2，LAYER_RANK.annList：排在菜单与大纲浮层之后，
// 与旧 Dock「菜单、大纲开着时让它们先关」一致）：Esc 由栈关到它时收列表、焦点回计数钮；
// 焦点在输入框里时这一下归输入框。栈接住的 Esc 在 window 捕获段就截断，轮不到下面
// 清除画布选中 —— 选中不算一层，只有栈没接住时才清。
import { useEffect } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { isTypingTarget } from '../../shared/keys.js';
import { AnnPopover } from './AnnPopover.jsx';
import { LAYER_RANK, useStackLayer } from './use-layer.js';

export function Dock() {
  var listOpen = useWorkbenchStore(function (s) { return s.annListOpen; });

  useStackLayer('ann-list', listOpen, function () {
    wbSet({ annListOpen: false });
    var badge = document.getElementById('wbann-count');
    if (badge) badge.focus();
  }, { rank: LAYER_RANK.annList, respectTyping: true });

  useEffect(function () {
    function onKey(event) {
      if (event.key !== 'Escape') return;
      if (isTypingTarget(event.target)) return;
      var s = wbGet();
      if (s.focusFrameKey || s.focusSectionId) {
        event.preventDefault();
        wbSet({ focusFrameKey: null, focusSectionId: null, focusAnnN: null });
      }
    }
    document.addEventListener('keydown', onKey, true);
    return function () { document.removeEventListener('keydown', onKey, true); };
  }, []);

  if (listOpen) {
    return (
      <div className="wb-dock-card wb-glass" id="wbann-pop" role="dialog" aria-label="这页的标注">
        <AnnPopover />
      </div>
    );
  }
  return null;
}
