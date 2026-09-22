# 0017 · 五阶段 ROADMAP：Web 退役 + Pages 统一 + CLI / 代理 / 文档 mention 方向

Status: 部分被取代 · Date: 2026-08-16 · Superseded-by: 0035（“Component Library 作系统行保留”一句作废） · Scope: `docs/2026-08-16-roadmap.md`

> 2026-09-22：阶段地图与各阶段方向仍现行（见 roadmap 顶部的 pp2 指针）；阶段 2 里
> Component Library 作系统行保留的那句被 0035 推翻——系统行藏起，跨页信号出现再开。

**Decided**（owner 2026-08-16 讨论定稿；`ROADMAP.md` 落盘为阶段地图，goal 驱动执行）:

- **Web 模式连壳退役**：它从不是模式，只是「无机壳的画板」；存量内容在 doc 壳下都有更好的家（variants 板 → 整页 doc；服务器目录/页面 → doc iframe 1:1）。模式 Seg 退役，Pages 统一为单一列表 + 行内壳标记；壳仍是页/帧属性。真边界不是 iOS / Web / HTML，而是**画布（迭代态）/ 文档（表达态）**两形态。桌面 web 原型需求真出现时按 web-kit 哲学重建。
- **CLI 注册入口心智**：想让一个页面进 pinpoint 就用 CLI；静态的 pinpoint 直接 host（/sites/ 管道），活的登记 URL 待代理映射。N 个项目小服务器 → 一台总线 + 一张登记表；能标注不是附带福利，是「用 pinpoint host」的全部意义。
- **live 代理画中画**走同源代理（含 WS 转发），取代 backlog 的「跨域 iframe + postMessage 桥」路线——同源使桥不必要。
- **文档模式 mention 活 frame**：doc 引用画布 frame → 水合活 DOM（可交互，同一份 fragment）；**标注双向透传**——标注绑定对象（frame + 内部锚点）不绑定视图，同一份存储、两处渲染、实时同步；文档导出时 frame 烤静态图；不做冻结/REV。
- **阶段切分原则**（owner 原话）：每刀按独立价值切，不按实现便利。五阶段与切开理由见 `ROADMAP.md`。
