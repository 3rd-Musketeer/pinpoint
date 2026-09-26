# 0037 · 单分支 main：日常开发与推送都在 main，功能按需开 worktree

Status: 现行 · Date: 2026-09-26 · Supersedes: 0004（main / dev 双分支）、0002（发布流程的半边） · Scope: `Justfile`、`AGENTS.md`、`README.md`

**Decided**（2026-09-26 owner：“现在好像不用分 dev 和 main 了，没有什么其他用户，默认就使用 main，也不用走 publish 流程了，有 feat 就开 worktree 来解决”）：

- 只有一个长期分支 `main`，唯一 clone 在 `repos/github.com/3rd-Musketeer/pinpoint/`，常驻服务从它起。
- `just ship-dev` 与 `just publish` 合成 `just ship`：在 `main` 上、工作区干净、不与 `origin/main`
  发散时跑 `npm run check` 并推 `origin/main`。
- 较大的功能开 `feat/*` worktree（`repos/.worktrees/github.com/3rd-Musketeer/pinpoint/<任务名>/`），
  做完 `--ff-only` 合回 `main` 并删掉 worktree 与分支。
- release worktree 与 `dev` 分支（本地、远端）删除。

**Why**：双分支服务的是“访客 clone 下来就是干净模板”，发布门禁比日常 check 多的只有一层：
在干净 worktree 里按 lockfile 装依赖。现在只有 owner 一个使用者，这层检查换来的是每次改动
要走两段推送、两个 worktree 都要干净。日常 `npm run check` 的 e2e 已在 `PREVIEW_TEMPLATE_ONLY=1`
下跑，模板视图的回归仍有人守。

**否掉的**：保留 release worktree 作“偶尔跑一次的干净安装检查”——没有触发它的时点，留着只会过期。
出现第二个使用者时再恢复干净安装门禁。
