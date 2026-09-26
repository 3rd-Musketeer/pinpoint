# 0002 · Template split + release workflow

Status: 部分被修订（实例内容排除仍现行） · Date: 2026-07-21 · Scope: `.git/info/exclude`、`content/previews/`

Superseded-by: ADR 0012（ADR 与设计正典放出 exclude 清单，教义随模板走）、ADR 0037（发布流程退役，单分支 main）

**Decided**: 本目录 git 化，git 只跟踪模板（框架 + Example Library + system 组件）。个人内容经 `.git/info/exclude` 本地排除（产品 preview 页、产品组件目录、decisions.md、CHANGELOG.local.md）；页面清单走 gitignored `previews/_index.local.json` 覆盖（workbench 先取 local，404 才回落 tracked）。
**Why**: exclude 不进共享 .gitignore，模板使用者看不到个人目录名。
**注意**: 锁屏字标默认已中性化为 HELLO（`data-lock-word` 覆盖）；个人锁屏已逐屏加 `data-lock-word="MORI"`。新增个人 preview 页 / 产品组件时记得同步加进 `.git/info/exclude` + `_index.local.json`。
