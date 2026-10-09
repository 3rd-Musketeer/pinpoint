// 按需显示标注列表；Esc 关闭列表或清除画布选择。
import { useEffect } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { isTypingTarget } from '../board-nav.js';
import { AnnPopover } from './AnnPopover.jsx';

export function Dock() {
  var listOpen = useWorkbenchStore(function (s) { return s.annListOpen; });

  useEffect(function () {
    function onKey(event) {
      if (event.key !== 'Escape') return;
      if (isTypingTarget(event.target)) return;
      // 一次 Esc 只关最上面那层：「···」菜单开着时它归菜单，列表留着。
      // Radix 的 dismiss 监听不 stopPropagation，且在 document 捕获段先于冒泡段把菜单摘掉；
      // 本监听挂捕获段、先于它注册，这里查到菜单还在，才分得清「关菜单」与「关列表」。
      if (document.querySelector('.wb-ann-more-menu')) return;
      var s = wbGet();
      if (s.annListOpen) {
        event.preventDefault();
        wbSet({ annListOpen: false });
        var badge = document.getElementById('wbann-count');
        if (badge) badge.focus();
        return;
      }
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
