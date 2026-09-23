# 0003 · Per-project annotation dir

Status: 现行（桶按条目分的半边由 0036 改为桶 = 页） · Date: 2026-07-21 · Superseded-in-part-by: 0036 · Scope: `src/server/lib/annotate-data-dir.js`、`~/.pinpoint/`

**Decided**: 标注落盘从共享 `~/.html-annotate/` 改为按项目 `~/.html-annotate/<repo目录名>-<绝对路径hash>/`（本实例=`ios-app-preview-html-template-1t8yetj`，旧文件已迁入）。路径从 `GET /health` 的 `dataDir` 读，`HTML_ANNOTATE_DATA_DIR` 可覆盖。
**Why**: workbench page key 恒为 /index.html，同机多 clone 共享目录会混标注、共享 clear/revision——clone-per-project 模式必踩。
