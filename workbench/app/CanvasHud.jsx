// 画布 HUD + dock（P1b cut3，goal-20260810-workbench-react-rebuild）— 渲染进
// #wbcanvas-dock / #wbcanvas-hud 两个静态容器。open/visible/zoom 状态全部订阅
// store（board-nav 命令式写入）；minimap 的 canvas 2D 绘制、section-nav 列表的
// innerHTML、几何测量仍归 board-nav 持有 —— #wbsection-nav-list 的 children 与
// #wbminimap-canvas 的宽高是不受管区域：JSX 永不声明它们，React 也就从不动它们。
// DOM id / class / 文案与原静态标记逐一对应（e2e 选择器即契约）。
// V3 换皮（goal-20260811-workbench-visual-rebuild）：皮肤收编 Tailwind 类 + token，
// index.html 旧规则删除。配方：
//  - 浮层语言 = 白面（bg-card = --wb-surface）+ 克制阴影（无发丝描边，2026-08-11 扁平化）
//    （dock 面板 --wb-sh-3；HUD 容器是静态标记，同款语言留在 index.html 手写 CSS，
//    值全 token）+ 圆角 --wb-r-4（rounded-xl）；
//  - section-nav/minimap 开关钮 = Button tool variant（V0 footer gear 同族），
//    on 态走 data-state=on 的 accent 面（替代旧「白底 + accent 字」手写态）；
//  - 缩放组 = 槽式分段语言（bg-muted + 2px 内衬 + h-6 项，SEG 同族）；−/读数/+ 是
//    瞬时动作不是单选，不走 ToggleGroup，只借槽/项皮肤；读数保持等宽数字
//    （tabular-nums）与 52px 最小宽；
//  - #wbsection-nav-list 的行（.wb-section-nav-item 系）是 board-nav 命令式构建的
//    不受管内容：保留手写 CSS（index.html，全 token 化），不进 Tailwind。
import { Fragment } from 'react';
import { useWorkbenchStore, wbGet } from './store.js';
import { recenterBoard, setMinimapOpen, setSectionNavigatorOpen } from '../board-nav.js';
import { setCanvasZoom } from '../boot-prefs.js';
import { clampCanvasZoom, currentCanvasZoom, formatZoomLabel } from '../lib/canvas-zoom.js';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { WbIcon } from './WbIcon.jsx';

// dock 两面板共用浮层皮肤（--wb-canvas-nav-w 定义在 index.html 的 .wb-canvas-dock 上）
var DOCK_PANEL =
  'relative box-border w-[var(--wb-canvas-nav-w)] rounded-xl bg-card ' +
  'shadow-[var(--wb-sh-3)]';
// 缩放组槽内项（SEG_ITEM 同族，去掉单选态）：24px 项 + 容器 2px 内衬 = 28px 档
var HUD_ITEM =
  'inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-sm border-0 ' +
  'bg-transparent px-1.5 font-sans text-[13px] font-semibold text-muted-foreground ' +
  'transition-[color,background-color] duration-150 hover:bg-accent hover:text-accent-foreground';

function nudgeZoom(factor) {
  setCanvasZoom(String(clampCanvasZoom(currentCanvasZoom() * factor)), { save: true });
}

export function CanvasDock() {
  var minimapOpen = useWorkbenchStore(function (s) { return s.minimapOpen; });
  var sectionNavOpen = useWorkbenchStore(function (s) { return s.sectionNavOpen; });
  var position = useWorkbenchStore(function (s) { return s.sectionNavPosition; });
  return (
    <Fragment>
      <nav id="wbsection-nav" aria-label="Section Navigator" hidden={!sectionNavOpen}
        className={cn('wb-section-nav', DOCK_PANEL, 'max-h-[min(320px,calc(100vh_-_92px))] overflow-hidden p-2')}>
        <div className="wb-section-nav-head box-border flex h-7 items-center justify-between gap-2.5 px-[7px] pb-[5px] text-[11px] font-bold text-foreground">
          <span>Section Navigator</span>
          <span className="wb-section-nav-status tabular-nums whitespace-nowrap text-[color:var(--wb-faint)]" id="wbsection-nav-status">{position}</span>
        </div>
        {/* 不受管容器：列表项由 board-nav 的 rebuildSectionNavigator 以 innerHTML 填充 */}
        <div className="wb-section-nav-list flex max-h-[min(272px,calc(100vh_-_140px))] flex-col gap-[3px] overflow-auto" id="wbsection-nav-list"></div>
      </nav>
      <div id="wbminimap" title="Canvas → Section → Frame · 点击定位"
        role="navigation" aria-label="Canvas、Section 与 Frame 缩略图导航"
        data-minimap-levels="canvas section frame" hidden={!minimapOpen}
        className={cn('wb-minimap', DOCK_PANEL, 'cursor-crosshair p-1.5')}>
        <div className="wb-minimap-head flex h-6 items-center justify-between gap-2 px-1 text-[10.5px] font-bold text-foreground">
          <span>Canvas map</span>
          <span className="wb-minimap-levels font-semibold text-[color:var(--wb-faint)]">Section · Frame</span>
        </div>
        <canvas id="wbminimap-canvas" width="416" height="264"
          className="block h-[132px] w-[calc(var(--wb-canvas-nav-w)_-_12px)] rounded-md bg-[color-mix(in_srgb,var(--wb-stage-bg)_88%,var(--wb-surface))]"></canvas>
      </div>
    </Fragment>
  );
}

export function CanvasHud() {
  var zoom = useWorkbenchStore(function (s) { return s.canvasZoom; });
  var minimapOpen = useWorkbenchStore(function (s) { return s.minimapOpen; });
  var minimapAvailable = useWorkbenchStore(function (s) { return s.minimapAvailable; });
  var sectionNavOpen = useWorkbenchStore(function (s) { return s.sectionNavOpen; });
  var sectionNavVisible = useWorkbenchStore(function (s) { return s.sectionNavVisible; });
  var position = useWorkbenchStore(function (s) { return s.sectionNavPosition; });
  var current = useWorkbenchStore(function (s) { return s.sectionNavCurrent; });
  var navLabel = (sectionNavOpen ? '关闭' : '打开') + ' Section Navigator'
    + (current ? '，当前 ' + current + '，' + position : '');
  return (
    <Fragment>
      {/* display 类会盖掉 [hidden] 的 UA 规则，visible=false 时显式 hidden 类还回来（V2 同例） */}
      <div id="wbsection-nav-wrap" hidden={!sectionNavVisible}
        className={cn('wb-section-nav-wrap relative items-center', sectionNavVisible ? 'flex' : 'hidden')}>
        <Button type="button" variant="tool" id="wbsection-nav-toggle"
          data-state={sectionNavOpen ? 'on' : undefined}
          className={cn('wb-hud-btn wb-toolbar-tool-btn wb-section-nav-toggle h-7 min-w-[54px] gap-[5px] px-2 text-[13px] font-semibold', sectionNavOpen && 'on')}
          title={sectionNavOpen ? '关闭 Section Navigator' : '打开 Section Navigator'}
          aria-label={navLabel} aria-expanded={sectionNavOpen ? 'true' : 'false'} aria-controls="wbsection-nav"
          onClick={function (e) {
            e.preventDefault();
            e.stopPropagation();
            setSectionNavigatorOpen(!wbGet().sectionNavOpen);
          }}>
          <WbIcon name="section-nav" size={14} className="size-3.5" />
          <span className="wb-section-nav-position tabular-nums whitespace-nowrap" id="wbsection-nav-position">{position}</span>
        </Button>
      </div>
      <div id="wbminimap-wrap" hidden={!minimapAvailable}
        className={cn('wb-minimap-wrap relative items-center', minimapAvailable ? 'flex' : 'hidden')}>
        <Button type="button" variant="tool" size="icon" id="wbminimap-toggle"
          data-state={minimapOpen ? 'on' : undefined}
          className={cn('wb-hud-btn wb-toolbar-tool-btn wb-minimap-toggle', minimapOpen && 'on')}
          title={minimapOpen ? '关闭缩略图导航' : '打开缩略图导航'}
          aria-label={minimapOpen ? '关闭缩略图导航' : '打开缩略图导航'}
          aria-expanded={minimapOpen ? 'true' : 'false'} aria-controls="wbminimap"
          onClick={function (e) {
            e.preventDefault();
            e.stopPropagation();
            setMinimapOpen(!wbGet().minimapOpen);
          }}>
          <WbIcon name="map" size={14} className="size-3.5" />
        </Button>
      </div>
      <span className="wb-toolbar-divider h-5 w-px flex-none bg-border" aria-hidden="true"></span>
      <div className="wb-hud-group flex items-center gap-px rounded-md bg-muted p-0.5" role="group" aria-label="画布缩放">
        <button type="button" className={cn('wb-hud-btn', HUD_ITEM)} id="wbzoom-out" title="缩小" aria-label="缩小"
          onClick={function () { nudgeZoom(1 / 1.1); }}>−</button>
        <button type="button" id="wbzoom-label" title="重置为 100%"
          className={cn('wb-hud-btn wb-hud-zoom', HUD_ITEM, 'min-w-[52px] px-1 text-[12px] tabular-nums tracking-[-0.01em] text-foreground')}
          onClick={function () { setCanvasZoom('1', { save: true }); }}>{formatZoomLabel(zoom)}</button>
        <button type="button" className={cn('wb-hud-btn', HUD_ITEM)} id="wbzoom-in" title="放大" aria-label="放大"
          onClick={function () { nudgeZoom(1.1); }}>+</button>
      </div>
      <Button type="button" variant="tool" id="wbrecenter" title="回到画布内容"
        className="wb-hud-btn wb-hud-recenter h-7 px-2.5 text-[12px] font-semibold"
        onClick={function () { recenterBoard(); }}>回中</Button>
    </Fragment>
  );
}
