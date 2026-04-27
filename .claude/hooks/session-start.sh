#!/usr/bin/env bash
#
# .claude/hooks/session-start.sh
#
# Stage 1 of the Claude Code infrastructure rollout. Runs at session start to
# verify the env, dependencies, and DB reachability Code needs before any
# work begins. Registered in .claude/settings.json under hooks.SessionStart.
#
# Per Claude Code's hook contract, a non-zero exit from a SessionStart hook
# is a non-blocking error: the session still starts, but stderr is surfaced
# in the transcript and stdout becomes context for Code. Code's policy
# (docs/CLAUDE_OPERATIONS.md §5) is to refuse DB-related work whenever this
# hook reports a failure.
#
# Never echoes DATABASE_URL — even partially. If a downstream tool emits an
# error that includes the URL, this script scrubs it before re-emitting.

set -o pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$PROJECT_DIR"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
log()  { printf '[session-start %s] %s\n'        "$(ts)" "$*"; }
fail() { printf '[session-start %s] FAIL: %s\n'  "$(ts)" "$*" >&2; }

OVERALL_OK=1

# Redact any postgres connection string that leaks into a captured stream.
scrub() { sed -E 's#postgres(ql)?://[^[:space:]]+#postgres://<redacted>#g'; }

# ─── 1. Required tools on PATH ──────────────────────────────────────────────
log "checking required tools (npm, npx, psql)"
for tool in npm npx psql; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool not found on PATH; cannot complete session-start checks"
    OVERALL_OK=0
  fi
done

# ─── 2. DATABASE_URL must be set ────────────────────────────────────────────
log "checking DATABASE_URL is set"
if [[ -z "${DATABASE_URL:-}" ]]; then
  fail "DATABASE_URL not set. Add the claude_code role's connection string"
  fail "to Claude Code project secrets. See docs/CLAUDE_OPERATIONS.md §6.2."
  OVERALL_OK=0
else
  log "DATABASE_URL is set"
fi

# ─── 3. node_modules (only install if missing) ──────────────────────────────
log "checking node_modules"
if [[ ! -d node_modules ]]; then
  log "node_modules missing; running 'npm install --no-audit --no-fund'"
  if npm install --no-audit --no-fund 2>&1 | scrub; then
    log "'npm install' succeeded"
  else
    fail "'npm install' failed"
    OVERALL_OK=0
  fi
else
  log "node_modules present; skipping 'npm install'"
fi

# ─── 4. Prisma client generation ────────────────────────────────────────────
log "running 'npx prisma generate'"
if npx --yes prisma generate 2>&1 | scrub; then
  log "prisma generate succeeded"
else
  fail "'npx prisma generate' failed"
  OVERALL_OK=0
fi

# ─── 5. DB reachability (SELECT 1 as the configured role) ───────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  log "testing DB reachability with SELECT 1"
  if PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -tAc 'SELECT 1' >/dev/null 2>&1; then
    log "DB reachability OK"
  else
    err_output="$(PGCONNECT_TIMEOUT=10 psql "$DATABASE_URL" -tAc 'SELECT 1' 2>&1 1>/dev/null || true)"
    safe_err="$(printf '%s' "$err_output" | scrub)"
    fail "DB reachability test failed: ${safe_err:-unknown error}"
    OVERALL_OK=0
  fi
else
  log "skipping DB reachability test (DATABASE_URL not set above)"
fi

# ─── 6. Summary ─────────────────────────────────────────────────────────────
if (( OVERALL_OK == 1 )); then
  log "session-start checks PASSED"
  exit 0
else
  fail "session-start checks did NOT all pass."
  fail "Per docs/CLAUDE_OPERATIONS.md §5, Code should refuse DB-related work"
  fail "until the reported failure is resolved."
  exit 1
fi
