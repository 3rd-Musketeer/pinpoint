# 0038 · 编号是显示编号、id 是身份；标注 note 退役

Status: 现行 · Date: 2026-09-28 · Supersedes-in-part: 0035（状态机里 check / done 带 note 的半边） · Scope: `src/workbench/lib/board-refs.js`、`src/server/lib/ann-refs.js`、`src/server/lib/ann-query.js`、`bin/pinpoint-cli.js`、两个 skill

**起因**：routine-creator 验收时 agent 说“C1、C1b 是帧的源文件名，画布上对应 D1、D2”。帧 id 被起成编号的样子
（`c1b-detail-time`），之后分区调序、段内插帧，两套编号对不上。同一页 #11 的 note 写着“D2 定时型同步删”，
写的时候 D2 是 `c1b-detail-time`，插帧后 D2 变成了 `c1c-run-noop`：编号写进留存文字也会指错。

**Decided**（2026-09-28 owner：“编号是 display id，实际的 SSOT id 是不变的”“把 note 机制先关掉吧，目前没觉得有用，还带来很多问题”）：

- 编号（A、B3）是显示编号，`boardRefs` 按 board 顺序现算、不落盘（2026-10-10 补注：多 tab 页里按 tab 各自从 A 重来，位置引用写 `<tab>:B3`，见 [ADR 0041](0041-page-tabs.md)）；section / screen 的 id 是不变的身份，帧 id 同时是
  源文件名和标注锚点。当场对话用编号，留存文字用 id。
- `boardRefs` 自己跳过 doc 帧（screen 或 section 上的 `shell: "doc"`），服务端拿 board.json 原文调用也和画布一致。
  此前只有画布先过 `canvasBoard` 再算，CLI 直接用原文：有 doc 分区的页，`ppnt check / shot / locate` 的字母比画布多一位。
- `ppnt list <页> --frames` 列编号 · 帧 id · 源文件 · 标题；`check` 帧标题写成“D1 · c1-detail · 标题”；`shot` 产物按 id
  命名、打印“编号 · id → 路径”；能写编号的地方都能写裸帧 id / 段 id。
- 帧 id 用描述内容的短词；`ppnt build` 对形如编号的 id（`^[a-z]{1,2}\d+[a-z]?(-|$)`）打一行提示，不算失败。
  已有帧不改名：改名会断标注。
- 标注 note 退役：`ppnt mark` 不再收 `--note`，状态端点不再写 `note`，画布卡、工作台列表、`ppnt check` 都不再显示。
  旧账本里的 `note` 字段原样留在盘上，不迁移、不删。看了不改的原因在对话里汇报。

**否掉的**：
- build 产物文件名带编号（`D1-detail.html`）：编号随调序变，深链 `?entry=<id>`、导出锚点 `#frame-<id>`、`@frame:<id>` 都靠 id 不变。
- `ppnt mark --note` 写入时把编号冻结成“D2（id）”：note 整体退役，这条随之取消。
