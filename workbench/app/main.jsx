// React chrome 入口（goal-20260810-workbench-react-rebuild P1b）— 左栏整树挂
// #wbside，右栏标注工作台挂 #wbann-side（2026-08-15 左右分工），折叠浮钮挂
// #wbrails，HUD/dock 挂 #wbcanvas-hud / #wbcanvas-dock（index.html 只留容器）；
// DOM id 契约不变（e2e 选择器即契约）。舞台（#wbstage 及其内容）永远不走 React。
import { createElement as h, Fragment } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './wb-tw.css';
import { wireCanvasHud } from '../board-nav.js';
import { initExportCore } from '../export-core.js';
import { Sidebar } from './Sidebar.jsx';
import { AnnPanel } from './AnnPanel.jsx';
import { DetailPanel } from './DetailPanel.jsx';
import { CanvasDock, CanvasHud, StageRails } from './CanvasHud.jsx';
import { ExportPicker } from './ExportPicker.jsx';
import { mountFrameMenu, sweepFrameMenus } from './frame-menu.jsx';

// frame ⋯ 菜单的 React 岛挂载器注入命令式层（P3；app → 命令式 是唯一允许的方向）。
initExportCore({ mountFrameMenu: mountFrameMenu, sweepFrameMenus: sweepFrameMenus });

createRoot(document.getElementById('wbside')).render(h(Sidebar));
// 右栏 = detail 面板（2026-08-17 选中模型）+ 标注工作台（decisions 2026-08-14
// 左右分工）：同一 root 上下两段，与左栏共享同一个 zustand store（模块级单例，
// 跨 root 生效）。detail 选中时展开、未选中不渲染，标注列表 flex-1 自然让位。
createRoot(document.getElementById('wbann-side')).render(h(Fragment, null, h(DetailPanel), h(AnnPanel)));
// 画布缘折叠浮钮（StageRails）挂 #wbrails（display:contents，定位锚在 stage-wrap）。
createRoot(document.getElementById('wbrails')).render(h(StageRails));
// 导出 picker（decisions 2026-08-15d 单入口）：挂 #wbexport-picker 静态容器，
// 开关态在 store.exportPickerOpen（HUD「导出」钮写入）。
createRoot(document.getElementById('wbexport-picker')).render(h(ExportPicker));

// flushSync 保证 HUD/dock DOM 已提交，紧随的 wireCanvasHud 句柄赋值不会落空
// （minimap 跳点 / section-nav 列表委派 / 键盘与 resize 监听在那里面）。
flushSync(function () {
  createRoot(document.getElementById('wbcanvas-dock')).render(h(CanvasDock));
});
flushSync(function () {
  createRoot(document.getElementById('wbcanvas-hud')).render(h(CanvasHud));
});
wireCanvasHud();
