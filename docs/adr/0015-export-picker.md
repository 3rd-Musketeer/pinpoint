# 0015 · 导出 picker 收敛：任意多选 + 预览 + 选项减重

Status: 现行（批注档缓期） · Date: 2026-08-15 · Scope: `workbench/app/ExportPicker.jsx`、`server/export-image-api.js`、`server/lib/zip-store.js`

**Decided**（owner 在体验板 picker 上拍板）:
- 批量规则 = 任意多选（勾选任意帧组合，section 行整选）+ 智能打包：单张直接下载 PNG，多张才 zip。
- 选项按「必须对应真实投放渠道差异」减重：格式固定 PNG（砍 WebP；复制 PNG 与下载统一，「透明强制 PNG」联动随之消失）；清晰度固定 2×（砍 1×）；背景保留三档（画布 / 白底 / 透明）。
- picker 两栏：左 proto tree，右实时预览（第一张选中帧，随背景 / 带说明刷新）；实现复用 `/api/export-image` 管线低清档 + debounce，不起新管线。
- 图纸内容（图注 = 引用号 + 屏名 + 尺寸，以及 frame note）永随导出，推翻旧 export-core 的「干净画面摘图注」语义。
- 批注烘进 frame 导出：当日缓期进 backlog（owner 复评无「带批注外发」场景；picker 曾做出带批注预览 mock，后按 backlog 惯例撤下）。doc 导出的批注烘焙管线（export-doc-bake + token 估算）原样在线保留，不删不改。
- 多选预览 = 选中几帧并排几帧（zip 里是什么就预览什么），不再只盯第一帧。
**Why**: 导出是交付动作，对话框每个选项都该对应一个真实投放渠道；WebP / 1× 没有渠道支撑。预览只服务改变视觉结果的选项（背景三档），格式与清晰度是文件属性，看预览无意义。
**Consequences**: per-frame / per-section 导出触发器、旧预设 radio、WebP / 1× 档在落地时拆除；⋯ 菜单里的导出入口删除，菜单本体看剩余项再定。doc 导出的批注烘焙支线（html-full / comments）不动。
