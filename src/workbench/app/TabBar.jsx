// 页 tab 切换条（ADR 0041，2026-10-10）—— 挂 #wbtabbar-root，叠在底部横条（Strip）正上方、
// 与它平行：同一套胶囊语言（.wb-glass 磨砂 + 居中），层级用同一档 --wb-z-strip。
// 只有 ≥ 2 个 tab 的页才渲染（存量 board 与单 tab 页整条不存在，#wbtabbar 查不到）。
// 条里每个 tab 是一个 role=tab 按钮；活动 tab 是浅 accent 面 + 字重，不用实心 accent
// （全页唯一的实心 on 态仍是横条上的“标注”段）。点击 = pages.js setActiveTab：只重挂那个 tab
// 的 section，视口与缩放按 tab 各存各的。
import { useWorkbenchStore } from './store.js';
import { setActiveTab, tabsOfActiveBoard } from '../pages.js';
import { cn } from './lib/utils.js';

var TAB_ITEM =
  'h-6 max-w-[160px] cursor-pointer truncate whitespace-nowrap rounded-full border-0 bg-transparent px-3 font-sans ' +
  'text-[11.5px] font-medium text-muted-foreground transition-[color,background-color] duration-150 ' +
  'hover:text-foreground';
var TAB_ON = 'bg-[var(--wb-fill)] font-semibold text-foreground';

export function TabBar() {
  var board = useWorkbenchStore(function (s) { return s.activeBoard; });
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var tabs = tabsOfActiveBoard();   // 订阅 activeBoard / activePageId 重渲染，取值走 pages.js
  if (!tabs.length) return null;
  var activeId = board && board.pageId === activePageId ? board.tabId : '';
  return (
    <div className="wb-tabbar wb-glass" id="wbtabbar" role="tablist" aria-label="页内 tab" data-ann-ui>
      {tabs.map(function (tab) {
        var on = tab.id === activeId;
        return (
          <button type="button" key={tab.id} role="tab" data-tab={tab.id}
            aria-selected={on ? 'true' : 'false'} title={tab.title}
            className={cn(TAB_ITEM, on && TAB_ON)}
            onClick={function () { setActiveTab(tab.id); }}>{tab.title}</button>
        );
      })}
    </div>
  );
}
