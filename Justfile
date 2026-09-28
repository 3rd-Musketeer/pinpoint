set shell := ["bash", "-cu"]

# Show the supported workflows when `just` is run without a recipe.
default:
    @just --list

# Start the local server on the stable Portless route.
dev:
    npm run dev

# Snapshot kept in .tmp/preview-data/; `git worktree remove` deletes it.
# In a feat worktree, serve this code on <branch>.pinpoint.localhost against a ~/.pinpoint snapshot.
preview:
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'preview: %s\n' "$*" >&2
      exit 1
    }

    [[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]] || fail "run this in a feat worktree; the primary clone serves the live service (just dev)"
    [[ -e node_modules ]] || fail "no node_modules in this worktree; run npm ci, or symlink the clone's node_modules"

    data="$PWD/.tmp/preview-data"
    if [[ ! -d "$data" ]]; then
      mkdir -p "$data"
      rsync -a --exclude dist --exclude migrations --exclude diagnostics --exclude logs --exclude shot --exclude 'registry.json.bak-*' "$HOME/.pinpoint/" "$data/"
      printf 'preview: copied ~/.pinpoint to %s\n' "$data"
    fi

    export PINPOINT_DATA_DIR="$data" PINPOINT_REGISTRY="$data/registry.json"
    exec npm run dev

# Run the canonical local verification suite.
check:
    npm run check

# Run all browser stories in two isolated groups.
e2e-parallel:
    npm run test:e2e:parallel

# Run browser stories serially, including isolated performance measurements.
e2e-serial:
    npm run test:e2e:serial

# Verify and push the clean main branch. This changes origin/main.
ship:
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'ship: %s\n' "$*" >&2
      exit 1
    }

    [[ "$(git branch --show-current)" == "main" ]] || fail "run this recipe on main in the primary clone"
    [[ -z "$(git status --porcelain)" ]] || fail "the worktree is dirty"

    git fetch --prune origin </dev/null
    git rev-parse --verify refs/remotes/origin/main >/dev/null
    git merge-base --is-ancestor origin/main HEAD || fail "origin/main is not an ancestor of local main; reconcile before pushing"

    npm run check
    [[ -z "$(git status --porcelain)" ]] || fail "verification changed the worktree"

    git push origin main
    git fetch --prune origin </dev/null
    [[ "$(git rev-parse HEAD)" == "$(git rev-parse origin/main)" ]] || fail "origin/main did not converge to local main"
