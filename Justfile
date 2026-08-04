set shell := ["bash", "-cu"]

# Show the supported workflows when `just` is run without a recipe.
default:
    @just --list

# Start the daily development worktree on the stable Portless route.
dev:
    npm run dev

# Run the canonical local verification suite.
check:
    npm run check

# Verify and push the clean dev branch. This changes origin/dev.
ship-dev:
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'ship-dev: %s\n' "$*" >&2
      exit 1
    }

    [[ "$(git branch --show-current)" == "dev" ]] || fail "run this recipe from the dev worktree"
    [[ -z "$(git status --porcelain)" ]] || fail "the dev worktree is dirty"

    git fetch --prune origin </dev/null
    git rev-parse --verify refs/remotes/origin/dev >/dev/null
    git merge-base --is-ancestor origin/dev HEAD || fail "origin/dev is not an ancestor of local dev; reconcile before pushing"

    npm run check
    [[ -z "$(git status --porcelain)" ]] || fail "verification changed the dev worktree"

    git push origin dev
    git fetch --prune origin </dev/null
    [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/dev)" ]] || fail "origin/dev did not converge to local dev"

# Fast-forward main to the verified dev tip and publish it. This changes origin/main.
publish:
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'publish: %s\n' "$*" >&2
      exit 1
    }

    [[ "$(git branch --show-current)" == "main" ]] || fail "run this recipe from the release worktree on main"
    [[ -z "$(git status --porcelain)" ]] || fail "the release worktree is dirty"

    git fetch --prune origin </dev/null
    git rev-parse --verify refs/heads/dev >/dev/null
    git rev-parse --verify refs/remotes/origin/dev >/dev/null
    git rev-parse --verify refs/remotes/origin/main >/dev/null

    dev_worktree="$(git worktree list --porcelain | awk '/^worktree / { path = substr($0, 10) } /^branch refs\/heads\/dev$/ { print path; exit }')"
    [[ -n "$dev_worktree" ]] || fail "the dev branch is not checked out in a worktree"
    [[ -z "$(git -C "$dev_worktree" status --porcelain)" ]] || fail "the dev worktree is dirty"
    [[ "$(git rev-parse dev)" == "$(git rev-parse origin/dev)" ]] || fail "local dev is not published to origin/dev; run 'just ship-dev' from the dev worktree first"
    git merge-base --is-ancestor origin/main origin/dev || fail "origin/main and origin/dev have diverged"
    git merge-base --is-ancestor HEAD origin/dev || fail "local main cannot fast-forward to origin/dev"

    git merge --ff-only origin/dev
    npm ci
    PREVIEW_TEMPLATE_ONLY=1 npm run check
    [[ -z "$(git status --porcelain)" ]] || fail "release verification changed the worktree"

    git push origin main
    git fetch --prune origin </dev/null

    release_sha="$(git rev-parse HEAD)"
    [[ "$release_sha" == "$(git rev-parse origin/main)" ]] || fail "origin/main did not converge to local main"
    [[ "$release_sha" == "$(git rev-parse origin/dev)" ]] || fail "origin/main and origin/dev do not match after publishing"
