// 文章页的弹层栈（[[ ]] popup、wiki 面板、目录 popover、画布浮层）：Esc 只关最上面一层。
// 实现已提升为站点与工作台共用的一份（C2，src/shared/layers.js，注入的标注客户端
// 与嵌入工作台也用它跨文档裁决 Esc）；这里只做两件事：给文章页装上栈与捕获段监听，
// 并把单例 `layers` 交给页面上的弹层注册。
// 约定不变：处理了 Esc 的一方 preventDefault；别的监听（注入的正文评论客户端
// src/client/prose-comments.js）见 e.defaultPrevented 就不动，所以关 popup 不会顺手
// 扔掉正在写的评论。契约在 site/README.md「弹层与 Esc」。
export { createLayerStack } from '../../../src/shared/layers.js';

import { attachLayerStack, createLayerStack } from '../../../src/shared/layers.js';

// e2e 在 Node 里 import client.js 取动效常量（e2e/article-viewer.spec.js），那里没有 window：
// 给一份不装监听的纯栈。
export const layers = typeof window === 'undefined' ? createLayerStack() : attachLayerStack(window);
