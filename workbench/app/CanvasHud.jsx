// 画布 HUD + dock（P1b cut3，goal-20260810-workbench-react-rebuild）— 渲染进
// #wbcanvas-dock / #wbcanvas-hud 两个静态容器。open/visible/zoom 状态全部订阅
// store（board-nav 命令式写入）；minimap 的 canvas 2D 绘制、section-nav 列表的
// innerHTML、几何测量仍归 board-nav 持有 —— #wbsection-nav-list 的 children 与
// #wbminimap-canvas 的宽高是不受管区域：JSX 永不声明它们，React 也就从不动它们。
// DOM id / class / 文案与原静态标记逐一对应（e2e 选择器即契约）。
import { Fragment } from 'react';
import { useWorkbenchStore, wbGet } from './store.js';
import { recenterBoard, setMinimapOpen, setSectionNavigatorOpen } from '../board-nav.js';
import { setCanvasZoom } from '../boot-prefs.js';
import { clampCanvasZoom, currentCanvasZoom, formatZoomLabel } from '../lib/canvas-zoom.js';
import { WbIcon } from './WbIcon.jsx';

function nudgeZoom(factor) {
  setCanvasZoom(String(clampCanvasZoom(currentCanvasZoom() * factor)), { save: true });
}

export function CanvasDock() {
  var minimapOpen = useWorkbenchStore(function (s) { return s.minimapOpen; });
  var sectionNavOpen = useWorkbenchStore(function (s) { return s.sectionNavOpen; });
  var position = useWorkbenchStore(function (s) { return s.sectionNavPosition; });
  return (
    <Fragment>
      <nav className="wb-section-nav" id="wbsection-nav" aria-label="Section Navigator" hidden={!sectionNavOpen}>
        <div className="wb-section-nav-head">
          <span>Section Navigator</span>
          <span className="wb-section-nav-status" id="wbsection-nav-status">{position}</span>
        </div>
        {/* 不受管容器：列表项由 board-nav 的 rebuildSectionNavigator 以 innerHTML 填充 */}
        <div className="wb-section-nav-list" id="wbsection-nav-list"></div>
      </nav>
      <div className="wb-minimap" id="wbminimap" title="Canvas → Section → Frame · 点击定位"
        role="navigation" aria-label="Canvas、Section 与 Frame 缩略图导航"
        data-minimap-levels="canvas section frame" hidden={!minimapOpen}>
        <div className="wb-minimap-head">
          <span>Canvas map</span>
          <span className="wb-minimap-levels">Section · Frame</span>
        </div>
        <canvas id="wbminimap-canvas" width="416" height="264"></canvas>
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
      <div className="wb-section-nav-wrap" id="wbsection-nav-wrap" hidden={!sectionNavVisible}>
        <button type="button" id="wbsection-nav-toggle"
          className={'wb-hud-btn wb-toolbar-tool-btn wb-section-nav-toggle' + (sectionNavOpen ? ' on' : '')}
          title={sectionNavOpen ? '关闭 Section Navigator' : '打开 Section Navigator'}
          aria-label={navLabel} aria-expanded={sectionNavOpen ? 'true' : 'false'} aria-controls="wbsection-nav"
          onClick={function (e) {
            e.preventDefault();
            e.stopPropagation();
            setSectionNavigatorOpen(!wbGet().sectionNavOpen);
          }}>
          <WbIcon name="section-nav" size={14} />
          <span className="wb-section-nav-position" id="wbsection-nav-position">{position}</span>
        </button>
      </div>
      <div className="wb-minimap-wrap" id="wbminimap-wrap" hidden={!minimapAvailable}>
        <button type="button" id="wbminimap-toggle"
          className={'wb-hud-btn wb-toolbar-tool-btn wb-minimap-toggle' + (minimapOpen ? ' on' : '')}
          title={minimapOpen ? '关闭缩略图导航' : '打开缩略图导航'}
          aria-label={minimapOpen ? '关闭缩略图导航' : '打开缩略图导航'}
          aria-expanded={minimapOpen ? 'true' : 'false'} aria-controls="wbminimap"
          onClick={function (e) {
            e.preventDefault();
            e.stopPropagation();
            setMinimapOpen(!wbGet().minimapOpen);
          }}>
          <WbIcon name="map" size={14} />
        </button>
      </div>
      <span className="wb-toolbar-divider" aria-hidden="true"></span>
      <div className="wb-hud-group" role="group" aria-label="画布缩放">
        <button type="button" className="wb-hud-btn" id="wbzoom-out" title="缩小" aria-label="缩小"
          onClick={function () { nudgeZoom(1 / 1.1); }}>−</button>
        <button type="button" className="wb-hud-btn wb-hud-zoom" id="wbzoom-label" title="重置为 100%"
          onClick={function () { setCanvasZoom('1', { save: true }); }}>{formatZoomLabel(zoom)}</button>
        <button type="button" className="wb-hud-btn" id="wbzoom-in" title="放大" aria-label="放大"
          onClick={function () { nudgeZoom(1.1); }}>+</button>
      </div>
      <button type="button" className="wb-hud-btn wb-hud-recenter" id="wbrecenter" title="回到画布内容"
        onClick={function () { recenterBoard(); }}>回中</button>
    </Fragment>
  );
}
