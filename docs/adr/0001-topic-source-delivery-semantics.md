# 0001 · Separate topic, source, and delivery semantics

Status: 现行（产品 SSOT 已归档到 workspace 的 .archive/2026-08-13-topic-subs/） · Date: 2026-07-20 · Scope: `content/previews/shared-calendar/`（实例内容，2026-08-17e 已迁出本仓）

**Decided**: Feed fixtures use focused topics (`宝贝今日饮食`, `宝贝情绪`, `硬件进展`); people are shown as sources, while Alert remains a realtime delivery priority rather than a content type.
**Why**: Broad topics and the unconfirmed “主动分享” mechanism made Alert urgency, Digest scope, and source identity contradict the reviewed product intent.
**Alternatives**: Rejected patching individual card copy while keeping `伴侣近况` and person-prefixed topic titles because the same drift would persist in timelines and legacy frames.
**Files**: `previews/shared-calendar/_topic-data.js`, feed renderers, topic strategy fixtures, and `topic-feed-order.test.js`.
**Product SSOT**: `cold-topic/2026-08-13-topic-subs/`（2026-08-13 归档）。
