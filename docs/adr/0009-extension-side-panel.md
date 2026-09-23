# 0009 · 扩展标注面板 = Chrome Side Panel（原生分屏）；点击必达 + 陈旧自愈

Status: 已退役（2026-09-22，扩展随 pp2 删除，见 ADR 0035） · Date: 2026-08-11 · Scope: `extension/`、`src/pages/panel.html`、`src/workbench/app/Panel.jsx`

**Decided**（owner 拍板，扩展 0.3.0 落地，dev `5a1ed12`）:
- 图标点击打开 **Chrome Side Panel**（`chrome.sidePanel.open`），标注列表/模式切换/跳转/编辑/删除搬进浏览器原生侧栏。页面内 `#ann-sidebar` 浮层不再是扩展场景的主控制面，保留给无扩展场景（`/sites/` 直开、S 键、工具条「列表」）。
- 面板页由 **pinpoint 服务托管**（`panel.html` + `workbench/app/Panel.jsx`），扩展壳（`sidepanel.html/js`）只做 tab 锁定、page-info 查询、命令转发与死法提示——行模型/样式（`lib/ann-row.js`、`lib/ann-list.css`）与 API/SSE 零复制。
- **写入单归页面 client**：面板动作经 `postMessage → 壳（校验 source+origin）→ content script → pinpoint:command DOM 桥 → client` 执行（goToMark/openMark/removeMark/toggleMode），SSE 广播回面板；面板永不直接写盘，无 revision 并发面。
- **点击必达契约**：点击永远有可见结果。死法分层提示（壳内本地渲染）：服务没起 / 页面不支持 / 桥没响应 / 页面组件过旧→⌘R / 未注册 / workbench 壳页。
- **陈旧自愈**：扩展重载前的旧标签页没有活 content script，面板壳经 `chrome.scripting` 幂等补注（`window.__pinpointContent` 守卫）后重试；页面内 client 过旧（无 `data-pinpoint-client` 标记）是唯一必须 ⌘R 的情形——`window.__pinpoint` 防重入守卫使 JS 层无法替换旧 client。

**Why**: 页面内浮层恒压右侧 280px，且 margin 推挤会让 fixed/vw/媒体查询破相——与「高保真评审必须看到真实布局」冲突；原生分屏让页面按更窄视口正常 reflow。此前 quiet no-op 让「client 过旧/未注册/插件坏了」三种死法不可分辨，点击必须有反馈。

**桥协议**（`data-pinpoint-*` on `<html>`，client 启动时打）：`data-pinpoint-client="1"` 就绪 / `data-pinpoint-entry` 账本归属 / `data-pinpoint-sidebar="suppressed"` 壳页抑制 / `data-pinpoint-mode` 交互|标注。

**自动化边界**（排查实测，后来者省时间）: 品牌 Chrome 151 忽略 `--load-extension`；Chromium 对程序化 `chrome.runtime.reload()` 的未打包扩展直接禁用（disable_reasons `1<<24`）；Playwright 点不了工具栏图标、开不了真 side panel——测试路径 = 壳作为普通标签页打开（SW 里 `chrome.tabs.create`）+ `?tab=<id>` 覆盖。
