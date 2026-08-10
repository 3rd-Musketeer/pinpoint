// React chrome 入口（goal-20260810-workbench-react-rebuild P1b）— 侧栏整树挂
// #wbside，HUD/dock 挂 #wbcanvas-hud / #wbcanvas-dock（index.html 只留容器）；
// DOM id 契约不变（e2e 选择器即契约）。舞台（#wbstage 及其内容）永远不走 React。
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { wbGet } from './store.js';
import { wireCanvasHud } from '../board-nav.js';
import { scheduleAnnSnap } from '../ann-bridge.js';
import { Sidebar } from './Sidebar.jsx';
import { CanvasDock, CanvasHud } from './CanvasHud.jsx';

createRoot(document.getElementById('wbside')).render(h(Sidebar));

// flushSync 保证 HUD/dock DOM 已提交，紧随的 wireCanvasHud 句柄赋值不会落空
// （minimap 跳点 / section-nav 列表委派 / 键盘与 resize 监听在那里面）。
flushSync(function () {
  createRoot(document.getElementById('wbcanvas-dock')).render(h(CanvasDock));
});
flushSync(function () {
  createRoot(document.getElementById('wbcanvas-hud')).render(h(CanvasHud));
});
wireCanvasHud({
  onSectionJump: function () { if (wbGet().annFilter === 'tab') scheduleAnnSnap(); }
});
