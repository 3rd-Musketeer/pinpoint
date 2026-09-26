# 0004 · Branch model: main = public template, dev = daily

Status: 已被取代 · Date: 2026-07-21 · Scope: `Justfile` · Superseded-by: 0037（单分支 main）

**Decided**: 远端公开仓心智改为两支——**`main`** = 对外模板（原 `release`）；**`dev`** = 日常开发（原 `main`）。实例目录跟 `dev`；纯模板校验 worktree（`~/workspace/ios-app-preview-release`）跟 `main`。
**发布**: 在干净模板视图跑 `npm ci && npm run check`（e2e 自带 `PREVIEW_TEMPLATE_ONLY=1`）后，把 `dev` tip 推到 `main`（`git push origin dev:main`，或 worktree 里 `reset --hard dev && push`）。
**远端**: https://github.com/3rd-Musketeer/ios-app-preview（public）。上仓内容只含模板；产品页名不进文档/测试 fixture。
**Why**: 访客默认落到可发布模板；本地实例继续在 `dev` 叠 exclude 内容，不必再记「还有一个 release」。
