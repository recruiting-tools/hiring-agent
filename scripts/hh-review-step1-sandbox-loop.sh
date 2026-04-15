#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-/Users/vova/Documents/GitHub/hiring-agent}"
if [[ -n "${MAIN_BRANCH:-}" ]]; then
  MAIN_BRANCH="$MAIN_BRANCH"
else
  if git -C "$REPO_DIR" show-ref --verify --quiet refs/heads/main; then
    MAIN_BRANCH="main"
  elif git -C "$REPO_DIR" show-ref --verify --quiet refs/heads/master; then
    MAIN_BRANCH="master"
  else
    echo "Unable to determine main branch; set MAIN_BRANCH explicitly"
    exit 2
  fi
fi
SANDBOX_BRANCH="${SANDBOX_BRANCH:-sandbox/hh-review-step1-playbook}"
TEST_CMD="${TEST_CMD:-}"
SMOKE_CMD="${SMOKE_CMD:-}"
LOG_FILE="${LOG_FILE:-/tmp/hh-review-step1-loop.log}"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$LOG_FILE"
}

run_cmd() {
  local label="$1"
  local cmd="$2"
  if [[ -z "$cmd" ]]; then
    log "skip: $label (command not set)"
    return 0
  fi
  log "start: $label :: $cmd"
  if ! bash -lc "$cmd"; then
    log "fail: $label"
    return 1
  fi
  log "done: $label"
}

log "--- HH Step 1 sandbox loop start ---"
cd "$REPO_DIR"

git rev-parse --is-inside-work-tree >/dev/null 2>&1

if ! git show-ref --verify --quiet "refs/heads/$SANDBOX_BRANCH"; then
  log "missing sandbox branch $SANDBOX_BRANCH"
  exit 2
fi

ORIGINAL_BRANCH="$(git symbolic-ref --short HEAD)"
log "starting from branch: $ORIGINAL_BRANCH"

log "checking remote availability"
if git remote | grep -q .; then
  log "remotes found: $(git remote | tr '\n' ' ')"
  git fetch --all --prune
else
  log "no remotes configured, using local state"
fi

git checkout "$MAIN_BRANCH"
log "on main branch: $MAIN_BRANCH at $(git rev-parse --short HEAD)"
if git remote | grep -q .; then
  git pull --ff-only || {
    log "main pull failed (non-ff or network error)"
    exit 3
  }
fi

git checkout "$SANDBOX_BRANCH"
log "switched to sandbox branch: $SANDBOX_BRANCH at $(git rev-parse --short HEAD)"

if git merge-base --is-ancestor "$MAIN_BRANCH" "$SANDBOX_BRANCH"; then
  log "sandbox already includes main"
else
  log "rebasing sandbox on $MAIN_BRANCH"
  git rebase "$MAIN_BRANCH" || {
    log "rebase failed, aborting manually required"
    exit 4
  }
fi

if [[ -n "$(git status --porcelain)" ]]; then
  log "working tree has uncommitted changes"
else
  log "working tree clean"
fi

if ! run_cmd "targeted tests" "$TEST_CMD"; then
  log "iteration stopped: targeted tests failed"
  git checkout "$ORIGINAL_BRANCH"
  exit 5
fi

if ! run_cmd "smoke checks" "$SMOKE_CMD"; then
  log "iteration warning: smoke failed; review logs"
  # keep loop alive for fast feedback: non-blocking signal
  log "consider this as non-blocking for the automated pass unless strict mode required"
fi

log "iteration summary: $(git log -1 --oneline)"
log "sandbox ready for next change"
git checkout "$ORIGINAL_BRANCH"
log "--- HH Step 1 sandbox loop end ---"
