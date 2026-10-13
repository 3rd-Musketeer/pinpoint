// 页 tab 条（ADR 0041，2026-10-10 追加大纲入口）。挂 #wbtabbar-root，叠在底部横条正上方。
// 有画布条目就渲染：≥ 2 个 tab 时每个标题钮旁一个大纲钮；不到 2 个时不列标题，只留一个
// 大纲钮（aria-label「大纲」）。纯 doc / url 页不渲染。分享页仍按「≥ 2 个 tab 才出条」，
// 不走这里。浮层在 OutlinePopover.jsx，Portal 到 body，避免被条的 overflow 裁掉。
import { useWorkbenchStore } from './store.js';
import { setActiveTab } from '../pages.js';
import { boardHasCanvas } from '../lib/board-entries.js';
import { boardTabList } from '../lib/board-tabs.js';
import { OutlineButton } from './OutlinePopover.jsx';
import { cn } from './lib/utils.js';

var TAB_ITEM =
  'h-6 max-w-[160px] cursor-pointer truncate whitespace-nowrap rounded-full border-0 bg-transparent px-3 font-sans ' +
  'text-[11.5px] font-medium text-muted-foreground transition-[color,background-color] duration-150 ' +
  'hover:text-foreground';
var TAB_ON = 'bg-[var(--wb-fill)] font-semibold text-foreground';

export function TabBar() {
  var active = useWorkbenchStore(function (s) { return s.activeBoard; });
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  if (!active || active.pageId !== activePageId) return null;
  var full = active.fullBoard || active.board;
  if (!boardHasCanvas(full)) return null;
  var tabs = boardTabList(full);
  var multi = tabs.length >= 2;
  var activeId = active.tabId || '';
  return (
    <div className="wb-tabbar wb-glass" id="wbtabbar" data-ann-ui
      role={multi ? 'tablist' : undefined}
      aria-label={multi ? '页内 tab' : '大纲'}>
      {multi ? tabs.map(function (tab) {
        var on = tab.id === activeId;
        return (
          <span className="wb-tab-slot inline-flex items-center gap-px" key={tab.id}>
            <button type="button" role="tab" data-tab={tab.id}
              aria-selected={on ? 'true' : 'false'} title={tab.title}
              className={cn(TAB_ITEM, on && TAB_ON)}
              onClick={function () { setActiveTab(tab.id); }}>{tab.title}</button>
            <OutlineButton tabId={tab.id} label={tab.title + '的大纲'} />
          </span>
        );
      }) : <OutlineButton label="大纲" />}
    </div>
  );
}
