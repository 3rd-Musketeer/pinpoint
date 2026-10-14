# 0003 · Per-project annotation dir

Status: 已被取代（数据根是 `~/.pinpoint/`，`PINPOINT_DATA_DIR` 覆盖；桶 = 页 id，见 0036；本条的 project 指一个 clone，和文章模型的 project 不是一回事） · Date: 2026-07-21 · Superseded-by: 0036 · Scope: `src/server/lib/annotate-data-dir.js`、`~/.pinpoint/`

**Decided**: 标注落盘从共享 `~/.html-annotate/` 改为按项目 `~/.html-annotate/<repo目录名>-<绝对路径hash>/`（本实例=`ios-app-preview-html-template-1t8yetj`，旧文件已迁入）。路径从 `GET /health` 的 `dataDir` 读，`HTML_ANNOTATE_DATA_DIR` 可覆盖。
**Why**: workbench page key 恒为 /index.html，同机多 clone 共享目录会混标注、共享 clear/revision——clone-per-project 模式必踩。
