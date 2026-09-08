// 右下按需浮层槽（2026-09-04 外壳重设计）—— 挂 #wbdock，锚在底部横条右端正上方。
// 一个槽，两个住客，永不同时出现：
//   · 标注列表（app/AnnPopover.jsx，评审板 H2）—— 点横条右端的计数钮开；
//   · detail 面板（app/DetailPanel.jsx，ADR 0026 的选中详情 + note 编辑）——
//     画布 / 大纲里选中 section 时出现，frame 不展示详情。
// 冲突规则：列表优先 —— 点计数钮就是「我要浏览这页还剩什么」，此刻 detail 让位。
// Esc 关掉当前这个（列表 → 关列表；detail → 清选中）。
// 两者共用同一块 280 玻璃卡（.wb-dock-card + .wb-glass，几何在 index.html）。
import { useEffect } from 'react';
import { useWorkbenchStore, wbGet, wbSet } from './store.js';
import { isTypingTarget } from '../board-nav.js';
import { AnnPopover } from './AnnPopover.jsx';
import { DetailPanel, useDetailTarget } from './DetailPanel.jsx';

export function Dock() {
  var listOpen = useWorkbenchStore(function (s) { return s.annListOpen; });
  var target = useDetailTarget();

  useEffect(function () {
    function onKey(event) {
      if (event.key !== 'Escape') return;
      if (isTypingTarget(event.target)) return;
      // 一次 Esc 只关最上面那层：「···」菜单开着时它归菜单，列表留着。
      // （Radix 的 dismiss 监听不 stopPropagation，不挡这条就会一次关两层。）
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
    document.addEventListener('keydown', onKey);
    return function () { document.removeEventListener('keydown', onKey); };
  }, []);

  if (listOpen) {
    return (
      <div className="wb-dock-card wb-glass" id="wbann-pop" role="dialog" aria-label="这页的标注">
        <AnnPopover />
      </div>
    );
  }
  if (!target) return null;
  return (
    <div className="wb-dock-card wb-glass" id="wbdetail-card">
      <DetailPanel target={target} />
    </div>
  );
}
