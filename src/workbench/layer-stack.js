// 工作台的弹层栈（C2）：浮层、菜单、标注列表、大纲浮层、导出 / 信息对话框、
// 标注框、mention、工具菜单、标注模式都注册进这一份，Esc 只问栈顶
// （src/shared/layers.js）。注入的标注客户端（annotate.js）经 window 标记拿到
// 同一份栈，把草稿、页面自己的层与标注模式作为适配层常驻其中；页面层的选择器
// 排除工作台自己的根。次序见 LAYER_RANK。模块加载即装监听；嵌入版没接住的 Esc 由
// embed.js 的 forward 交给文章页。
import { attachLayerStack } from '../shared/layers.js';

export var wbLayers = attachLayerStack(window);
