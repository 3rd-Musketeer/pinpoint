# 0027 · 注入契约统一 + registry 补全 + 实例迁出 previews/

Status: 现行 · Date: 2026-08-17 · Scope: `src/server/preview-inject.js`、`src/server/lib/registry-store.js`、`content/previews/`

Relates-to: ADR 0022（把「serve 即注入即标」落实到 previews 路径）

**Decided**（owner 2026-08-17 连问「最近好几次都是 preview 无法标注，分析原因」「previews 和 registry 的区别是什么，为什么不统一」「我们自己的 previews 应该不承担存放这些文件的责任了，他们自己选择放置的地方用 registry 注册，是吗」后确认方案，要求完整实现）：

- **注入契约统一 = serve 即注入**（新插件 `server/preview-inject.js`）：任何含 `<!doctype` 的 `previews/**.html` 响应自动注入 annotate 客户端（`?annotate=off` 豁免，导出管线同步改走它；fragment 无 doctype 天然放行）。previews 注入**不带 entry 标记**——账本 ENTRY 保持缺省 `'pinpoint'`，与手工注入段时代逐字节一致，存量账本不受影响。手工注入 IIFE 从此不再必要（模板 doc-library 的该段已删，模板自身dogfood新契约）；存量页面的手工段由客户端 `window.__pinpoint` 防双载兜底。机制根因记录：previews 走 vite 静态零注入、靠每页抄 18 行 IIFE，漏抄即静默无法标注（weekly-review 三草稿、detail-panel-variants 实证，debugging.md 有案）。
- **registry 补全三块**（实例搬迁的地基）：一、note 写回——`frame-note-store` 的 board.json 解析从只认 `previews/` 扩到 registry dir 条目（vite.config 把共享 registryStore 传入 frame-notes-api；仓外 board.json 同一份 revision 语义）。二、dir HMR——`preview-hmr` 经 `server.watcher.add` 补挂仓外条目目录（vite 默认只 watch 仓库根），变更文件按最长前缀映射到条目 id 发 `preview:update`；仓库自身默认条目显式排除（不吞 workbench 源码的默认 HMR）；条目增删经 vite.config 包装 `registryStore.reload` 同步 watch 集合。三、桥健壮性——`watchDocAnnotate` 从「绑一次就停」改为 html 形态期间持续轮询、客户端实例变化即重绑（iframe 重载后面板不再失联，debugging.md 次生现象条闭环）。
- **实例全部迁出 previews/**（owner-local 操作，不进 git）：17 个实例页 mv 到 owning topic——areta-time（time-insight / goal-weekly / daily-review / jita / shared-calendar / cal-consent / weekly-review / wr-settings / mcp-settings）、my-todos（smart-todo）、areta-chat（areta-chat）、pinpoint 自己（playground/ 下 7 个 variants/体验板/demo），`pinpoint add --id` 保留原 page id（标注账本与 note 按 id 寻址，无感迁移）；`_index.local.json` 删除（registry 接管实例页声明）；`.git/info/exclude` 的 previews/* 清单退役、改挂 `playground/`；eval-reports 页删除（唯一内容是已死的 symlink，registry 里本就有替代条目）。previews/ 收敛为纯模板（library + doc-library）。
- **搬迁暴露的两个隐藏问题一并修复**：一、weekly-review 九个 HTML 是逃出条目目录的 symlink（指向 cold-topic 实验目录）——`/sites/` 的防泄漏契约（realpath 不出条目目录）拒绝服务，dereference 复制为真实文件（playground 自包含，cold-topic 原件不动）。二、dev server 的 SPA fallback 把不存在的 `_index.local.json` 喂成 index.html（200 + text/html），`loadPageManifest` 的「缺失回落」从未在 dev 生效（此前被该文件恒存在掩盖；e2e 靠 template-only 插件 404 才正常）——修判定为「200 且 content-type 是 JSON 才解析，否则按缺失回落」。
- **遗留（backlog）**：owner-local kit 组件（areta-* / time-* / energy-* 等）仍住 `kits/ios/components/`（Component Library 与存量页面 include 依赖；page-local 组件解析与归属另议）；registry 里 areta-chat-eval 条目路径失效（owner 自行决定重指或删除）。

**Why**: 「previews 和 registry 为什么不统一」的正确答案不是合并概念（模板必须进 git 零设置，实例不该污染模板仓库），而是统一契约——第四条轴（注入）对齐后，previews vs registry 只剩「进 git 的模板 vs 机器本地的登记」这一个资产属性差别。搬迁让 previews/ 回归单一职责，agent 在 owning topic 里改页面、note、标注全部同权，不再有两个世界。
