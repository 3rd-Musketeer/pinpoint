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

    [[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]] || fail "run this in a feat worktree; in the primary clone use just staging"
    [[ -e node_modules ]] || fail "no node_modules in this worktree; run npm ci, or symlink the clone's node_modules"

    data="$PWD/.tmp/preview-data"
    if [[ ! -d "$data" ]]; then
      mkdir -p "$data"
      rsync -a --exclude dist --exclude migrations --exclude diagnostics --exclude logs --exclude shot --exclude 'registry.json.bak-*' "$HOME/.pinpoint/" "$data/"
      printf 'preview: copied ~/.pinpoint to %s\n' "$data"
    fi

    export PINPOINT_DATA_DIR="$data" PINPOINT_REGISTRY="$data/registry.json"
    exec npm run dev

# Run the canonical local verification suite: unit tests, the site build check, e2e.
check:
    npm run check

# Run all browser stories in two isolated groups.
e2e-parallel:
    npm run test:e2e

# Run all browser stories in one group with one server, one spec after another.
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

# The live service (pinpoint.localhost, global ppnt) runs from a detached release worktree, not this clone;
# rollback is just promote <previous sha>.
# Move the live service to <rev> (default main), reinstall if the lockfile changed, restart.
promote rev="main":
    #!/usr/bin/env bash
    set -euo pipefail

    fail() {
      printf 'promote: %s\n' "$*" >&2
      exit 1
    }

    main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
    rel="${PINPOINT_RELEASE_DIR:-${main/\/repos\//\/repos\/.worktrees\/}/release}"
    [[ -d "$rel" ]] || fail "no release worktree at $rel; create it: git worktree add --detach $rel main && (cd $rel && npm ci)"
    [[ -z "$(git -C "$rel" status --porcelain)" ]] || fail "$rel is dirty; the release worktree only moves by promote"
    [[ -z "$(git -C "$rel" branch --show-current)" ]] || fail "$rel is on a branch; portless would serve it on <branch>.pinpoint.localhost"

    target="$(git rev-parse --verify "{{rev}}^{commit}")"
    prev="$(git -C "$rel" rev-parse HEAD)"
    git -C "$rel" checkout -q --detach "$target"
    if ! git diff --quiet "$prev" "$target" -- package-lock.json; then
      (cd "$rel" && npm ci --no-audit --no-fund)
    fi
    node "$rel/bin/pinpoint.mjs" restart
    mkdir -p "$HOME/.pinpoint/logs"
    printf '%s %s -> %s\n' "$(date +%Y-%m-%dT%H:%M:%S)" "$prev" "$target" >> "$HOME/.pinpoint/logs/releases.log"
    printf 'promote: %s -> %s; rollback: just promote %s\n' "${prev:0:7}" "${target:0:7}" "${prev:0:7}"

# Annotations made here stay in the snapshot; each run re-copies it. Foreground; Ctrl-C stops service and site.
# Staging: serve this checkout on 127.0.0.1:<port> against a fresh ~/.pinpoint snapshot.
staging port="4900":
    #!/usr/bin/env bash
    set -euo pipefail

    data="${XDG_CACHE_HOME:-$HOME/.cache}/pinpoint-staging"
    mkdir -p "$data"
    rsync -a --delete --exclude dist --exclude migrations --exclude diagnostics --exclude logs --exclude shot --exclude render \
      --exclude 'backups-*' --exclude 'registry.json.bak-*' --exclude vite-cache --exclude env.sh "$HOME/.pinpoint/" "$data/"
    printf 'staging: copied ~/.pinpoint to %s\n' "$data"
    exec node bin/pinpoint.mjs dev --sandbox "$data" --port "{{port}}"
