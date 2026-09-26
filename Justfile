set shell := ["bash", "-cu"]

# Show the supported workflows when `just` is run without a recipe.
default:
    @just --list

# Start the local server on the stable Portless route.
dev:
    npm run dev

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
