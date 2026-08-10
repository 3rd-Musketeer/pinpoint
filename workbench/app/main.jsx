// React chrome 入口（goal-20260810-workbench-react-rebuild P1b）— chrome 组件
// 逐块出壳、挂载到 index.html 的静态挂载点；DOM id 契约不变（e2e 选择器即契约）。
// 舞台（#wbstage 及其内容）永远不走 React，由命令式模块持有。
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { AnnPanel } from './AnnPanel.jsx';

createRoot(document.getElementById('wbann-root')).render(h(AnnPanel));
