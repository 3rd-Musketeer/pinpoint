// React chrome 入口（goal-20260810-workbench-react-rebuild P1b）— 侧栏整树挂在
// #wbside（index.html 只留空壳）；DOM id 契约不变（e2e 选择器即契约）。
// 舞台（#wbstage 及其内容）与 HUD/dock 永远不走 React，由命令式模块持有。
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { Sidebar } from './Sidebar.jsx';

createRoot(document.getElementById('wbside')).render(h(Sidebar));
