// Chrome Side Panel 面板页入口 —— 独立于 workbench 壳的轻量路由（panel.html
// 承载）。不挂 Sidebar/CanvasHud，不启动舞台；面板是纯数据视图。
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import './wb-tw.css';
import { Panel } from './Panel.jsx';

createRoot(document.getElementById('panel-root')).render(h(Panel));
