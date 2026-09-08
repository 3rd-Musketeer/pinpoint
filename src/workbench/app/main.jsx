// React chrome 入口（goal-20260810-workbench-react-rebuild P1b）— 2026-09-04
// 外壳重设计后的挂载点清单：左栏整树挂 #wbside（浮动玻璃面板），底部横条挂
// #wbstrip（app/Strip.jsx，内含画布工具那一段 CanvasHud），按需浮层槽挂 #wbdock
// （app/Dock.jsx：标注列表），dock 面板挂 #wbcanvas-dock。
// 右栏（#wbann-side）与画布两缘浮钮（#wbrails）随本刀退役。
// DOM id 契约不变（e2e 选择器即契约）。舞台（#wbstage 及其内容）永远不走 React。
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './wb-tw.css';
import { wireCanvasHud } from '../board-nav.js';
import { initExportCore } from '../export-core.js';
import { Sidebar } from './Sidebar.jsx';
import { Dock } from './Dock.jsx';
import { Strip } from './Strip.jsx';
import { CanvasDock } from './CanvasHud.jsx';
import { ExportPicker } from './ExportPicker.jsx';
import { mountFrameMenu, sweepFrameMenus } from './frame-menu.jsx';

// frame ⋯ 菜单的 React 岛挂载器注入命令式层（P3；app → 命令式 是唯一允许的方向）。
initExportCore({ mountFrameMenu: mountFrameMenu, sweepFrameMenus: sweepFrameMenus });

createRoot(document.getElementById('wbside')).render(h(Sidebar));
// 右下按需浮层槽：标注列表（评审板 H2）与 detail 面板（ADR 0026）共用一块卡，
// 二选一显示，列表优先。与左栏共享同一个 zustand store（模块级单例，跨 root 生效）。
createRoot(document.getElementById('wbdock')).render(h(Dock));
// 导出 picker（decisions 2026-08-15d 单入口）：挂 #wbexport-picker 静态容器，
// 开关态在 store.exportPickerOpen（横条「导出」钮写入）。
createRoot(document.getElementById('wbexport-picker')).render(h(ExportPicker));

// flushSync 保证横条 / dock 的 DOM 已提交，紧随的 wireCanvasHud 句柄赋值不会落空
// （minimap 跳点 / section-nav 列表委派 / 键盘与 resize 监听在那里面）。
flushSync(function () {
  createRoot(document.getElementById('wbcanvas-dock')).render(h(CanvasDock));
});
flushSync(function () {
  createRoot(document.getElementById('wbstrip')).render(h(Strip));
});
wireCanvasHud();
