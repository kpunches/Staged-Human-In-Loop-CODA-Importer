# Claude Code Operations

Governance document for what Claude Code is allowed to do against this
repository's infrastructure (Postgres on Render, the Render platform itself,
and GitHub). This file is the source of truth. If a behavior is not described
here, Claude Code should not perform it.

**Status:** Stage 1 of 6 (database read access — PR open). Stage 0 is
complete. Code's actual database capabilities remain at the Stage 0
(none) level until the Operator completes the Stage 1 setup steps
(see [§8.3](#83-postgres-stage-1)).

**Last revised:** 2026-04-27 (Stage 1 PR — adds the role-creation SQL,
session-start hook, read-only Prisma allowlists, psql `ask` tier, and
the Stage 1 setup procedure under §8.3. Earlier same-day revision:
Stage 0 review feedback on §4 Stage 1 row, §7 Layer 1 ordering, §8.3
audit infrastructure, and §8.5 transcript durability.)

---

## 1. Definitions

- **Code** — Claude Code, the AI agent operating in sessions of this
  repository. Singular noun; can be replaced at any time by revoking the
  credentials and access listed in [Kill-switch](#7-kill-switch).
- **Operator** — the human owner of this repository and its production
  infrastructure (currently `kpunches`). The Operator owns all credentials
  and is the only party authorized to apply changes to production state.
- **Repo** — `kpunches/Staged-Human-In-Loop-CODA-Importer` on GitHub. Code's
  GitHub MCP access is locked to this repo and only this repo.
- **Master credentials** — the original master Postgres role created by Render
  at database provisioning time. Used by the Operator only. The application
  itself runs as the master role too (this can be hardened later).
- **`claude_code` role** — a future scoped Postgres role with read-only
  privileges, created in Stage 1. Does not exist yet.

---

## 2. Operating principles (apply to all stages)

1. **Code prepares; the Operator applies.** Code writes SQL migrations, config
   changes, and scripts. The Operator runs every command that touches
   production state with master credentials. The same human-in-the-loop
   principle that protects Coda writes applies to infrastructure changes.
2. **Each stage of the rollout lands as one reviewable PR.** No bundling.
   No work begins on stage N+1 until the Operator confirms stage N is gated
   through.
3. **No access is silently expanded.** New permissions only enter
   `.claude/settings.json` as part of a stage PR that the Operator reviews
   and merges. Any out-of-band escalation is a bug.
4. **Deny wins.** Per Claude Code's permissions model, `deny` rules override
   `ask` rules, which override `allow` rules. When two rules conflict, the
   one that prohibits action is honored.
5. **Sessions are stateless.** Anything Code learns in a session ends with
   the session, except what it commits to git. Credentials must be supplied
   to each session via Claude Code project secrets, not stored in the repo.

---

## 3. Permission tiers

Permissions in `.claude/settings.json` use three tiers, mapped to the
Claude Code permissions schema:

| Tier | Settings key | Behavior | Use for |
|---|---|---|---|
| **Silent allow** | `permissions.allow` | Code runs the tool without prompting the Operator. | Read-only commands; idempotent diagnostics; commands whose effects are local to the session sandbox. |
| **Prompt and confirm** | `permissions.ask` | Operator sees a prompt every time Code attempts the tool and must approve it. | Commands that prepare or simulate state changes (e.g. writing a migration file, generating a Prisma client) but do not yet hit production. Also: Render writes (Stage 6). |
| **Forbid** | `permissions.deny` | Code cannot invoke the tool, period. Even if `allow`/`ask` would otherwise permit. | Commands that mutate production state without a human in the loop; destructive commands; anything outside the rollout's scope. |

The Stage 0 skeleton at `.claude/settings.json` declares all three arrays
empty. Subsequent stages populate them per the matrix in
[Section 4](#4-rollout-status).

---

## 4. Rollout status

| Stage | Title | State | What lands |
|---|---|---|---|
| 0 | Governance foundation | complete (PR #1) | This document; empty `.claude/settings.json` skeleton. No access granted. |
| 1 | Database read access | **active (PR open)** | `scripts/setup/create-claude-code-role.sql` (read-only role); `.claude/hooks/session-start.sh` (env / deps / reachability check, registered under `hooks.SessionStart`); allowlist entries for `npx prisma migrate status`, `npx prisma db pull`, `npx prisma generate`; `ask`-tier entry for `Bash(psql *)` (the matcher cannot reliably distinguish `SELECT` from destructive queries inside quoted `-c` arguments — see PR description); deny entries for `npx prisma migrate reset`, `npx prisma db push`, and `npx prisma migrate deploy`; Stage 1 setup procedure for Postgres audit infrastructure (`pg_stat_statements`, connection-lifecycle logging, optional statement logging) — Operator runs the SQL, populates the secret, completes the audit-config steps, and records the result in the PR. See [§8.3](#83-postgres-stage-1). |
| 2 | Demo-login cleanup migration | not started | The previously-paused Commit C; runs against production using **master** credentials, not the `claude_code` role. |
| 3 | Migration preparation workflow | not started | `ask`-tier entries for migration-related Prisma commands; `scripts/dry-run-migration.sh` helper; "Code prepares, human applies" formalized. |
| 4 | Render MCP — research and vet | not started | `docs/RENDER_MCP_EVALUATION.md` only. No MCP configured. |
| 5 | Render MCP — read-only | not started | Render MCP server configured in project settings; allowlists for read-only Render tools (list services, read deploy status/logs, read env-var **names**). |
| 6 | Render MCP — selective writes | not started | `ask`-tier entries for trigger-deploy / restart-service / set-env-var. Service deletion, database deletion, billing, team management, plan/region changes are forbidden. `docs/RENDER_OPERATIONS.md` runbook. |

This table is updated as each stage's PR lands.

---

## 5. Capability matrix

This matrix describes Code's capabilities once each merged stage's setup
steps are complete (both code merged AND any Operator actions performed).
Capabilities gated on Operator action are marked with the gate. Until the
Operator completes a stage's setup, Code's actual capabilities remain at
the prior stage's level even if a later stage's PR has merged.

### 5.1 What Code can do

**Always (Stage 0+):**

- Read any file in the repo via the Read tool.
- Edit/write files in the repo via Edit/Write/NotebookEdit tools.
- Run shell commands via Bash, subject to the permission tiers in
  `.claude/settings.json` and any prompts the Operator sees in their
  session UI.
- Use the GitHub MCP tools, scoped to
  `kpunches/Staged-Human-In-Loop-CODA-Importer` only: read/create/comment
  on issues and PRs, read/create branches, push commits, read
  commits/tags/releases, read deploy info, etc.
- Spawn subagents (`Explore`, `Plan`, `general-purpose`, `claude-code-guide`).
- Use built-in skills declared by the Operator's harness.

**Stage 1 (after Operator runs `scripts/setup/create-claude-code-role.sql`
and adds the `claude_code` connection string as `DATABASE_URL` in Claude
Code project secrets):**

- Connect to Postgres as the `claude_code` role. The role has `LOGIN`,
  `CONNECT`, schema `USAGE`, and `SELECT` on existing and future tables
  in `public`. It has nothing else — no DDL, no `INSERT`/`UPDATE`/`DELETE`,
  no `SUPERUSER`/`CREATEDB`/`CREATEROLE`/`REPLICATION`/`BYPASSRLS` flags.
- Run silent-allowed Prisma diagnostics: `npx prisma migrate status`,
  `npx prisma db pull`, `npx prisma generate`. These are read-only and
  do not require Operator approval per call.
- Run ad-hoc `psql` commands against the database, subject to per-call
  Operator approval (`ask` tier). The matcher cannot enforce a
  SELECT-only restriction at the settings level (Bash patterns cannot
  reliably see inside quoted `-c` arguments — see Claude Code's
  permissions docs); the actual safety guarantee comes from the role's
  read-only Postgres grants, not from the prompt.

### 5.2 What Code cannot do

**Stage 0+:**

- Reach Render's API or dashboard in any way (Stages 5–6 add this).
- Touch any GitHub resource outside the one allowed repo.
- Invoke MCP tools other than the GitHub-scoped set above.
- Bypass any Operator permission prompt.

**Stage 0 (and Stage 1 until Operator setup completes):**

- Connect to Postgres at all (no `DATABASE_URL`, no `claude_code` role).

### 5.3 What Code must not do at any stage

These are forbidden by policy. Even if the harness or the role's grants
would technically allow the action, Code does not perform it.

- Apply database migrations to production. Migration files are written by
  Code; `prisma migrate deploy` against production is run by the Operator.
- Use master Postgres credentials. Master credentials are only ever held by
  the Operator. Code uses `claude_code` once that role exists (Stage 1+).
- Attempt to write through the `claude_code` role. The role's grants are
  read-only — any write would be rejected by Postgres anyway — but Code
  must not attempt one regardless. If Code believes a write is needed, it
  prepares a migration file for the Operator to apply (see §2 principle 1).
- Modify Render billing, delete services, delete databases, change service
  plan or region, or manage team members.
- Force-push to `main`, delete branches without explicit instruction, rewrite
  commit history on shared branches, or skip commit hooks.
- Commit credentials, API keys, connection strings, or secrets to git, even
  to `.env.local`-style example files. Example files contain placeholder
  values only.

---

## 6. Credential rotation

The Operator rotates credentials. Code never holds long-lived credentials
outside the per-session env injection.

### 6.1 Postgres master password

When to rotate: on any suspected leak; after Stage 1 setup; on a regular
schedule (Operator's discretion).

1. Render dashboard → `wgu-staging-db` → "Reset database password".
2. Update the `DATABASE_URL` env var on the `wgu-staging-app` web service
   (Render dashboard → service → Environment).
3. If the Operator has a local `.env.local` for development, update it there
   too.

The master password is **not** added to Claude Code project secrets at any
stage. Code only ever sees the `claude_code` role's connection string.

### 6.2 `claude_code` role password (Stage 1+)

When to rotate: on any suspected leak; on a regular schedule; when an
Operator suspects a session may have been compromised.

1. Connect as the master role: `psql $MASTER_DATABASE_URL`.
2. `ALTER USER claude_code WITH PASSWORD '<new>';`
3. Update the `DATABASE_URL` secret in Claude Code project settings.
4. Old sessions retain their connection until they're closed. New sessions
   pick up the new password automatically.

### 6.3 Render API token (Stage 5+)

When to rotate: on any suspected leak; when narrowing scope; when changing
which Render account the token belongs to.

1. Render dashboard → Account → API Keys → revoke the existing key.
2. Generate a new key with the narrowest scope per Stage 4's evaluation.
3. Update the Render token in Claude Code project secrets.

### 6.4 GitHub access

Code's GitHub MCP scope is governed by the GitHub App installation on the
repo. To narrow or revoke, the Operator manages it from
`https://github.com/settings/installations` (or the org equivalent).

---

## 7. Kill-switch

Use this procedure when Code's access must be revoked immediately —
suspected compromise, unintended action, or simply to pause work.

The procedure is layered. Each layer revokes a distinct capability. Use as
many as the situation warrants; for a true emergency, run all of them.

### Layer 1 — Database access (Stage 1+)

The right step ordering depends on the scenario. The two named scenarios
differ in whether the credential must die immediately (compromise) or
whether a clean shutdown is acceptable (planned pause).

#### Scenario A — active compromise

Use when there is a suspected key leak, ongoing unauthorized use, a
hostile session, or any reason to believe a third party may currently
hold a working credential. The credential is invalidated **first**;
every other step is secondary.

1. As master, run
   `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM claude_code;`
   followed by `DROP USER claude_code;`.
   - Effect: every connection currently open under that role fails on
     its next query, and no new connections can be opened. This is the
     hard stop; do this first regardless of who else might be holding
     the credential.
2. Rotate the master password per [6.1](#61-postgres-master-password).
   Defense in depth in case the leak extends beyond the `claude_code`
   role (for example, if the master credential itself is suspected).
3. Remove `DATABASE_URL` from Claude Code project secrets to prevent
   future sessions from receiving the (now-dead) credential and to
   eliminate a stale-config foot-gun later.

#### Scenario B — routine pause

Use when there is no suspected breach: planned maintenance, a
deliberate stand-down between stages, or a session ending naturally.
Cleaner shutdown order — secrets first, then the role.

1. Remove `DATABASE_URL` from Claude Code project secrets.
   - Effect: future sessions cannot connect.
   - Caveat: an in-flight session retains the env var it was started
     with until that session ends.
2. As master, run
   `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM claude_code;`
   followed by `DROP USER claude_code;`.
3. (Optional) rotate the master password per
   [6.1](#61-postgres-master-password).

### Layer 2 — Render API access (Stage 5+)

1. Render dashboard → Account → API Keys → revoke the Code-issued key.
2. Remove the token secret from Claude Code project secrets.

### Layer 3 — GitHub access

1. `https://github.com/settings/installations` → the relevant installation
   → "Suspend" (reversible) or "Uninstall" (full).
2. Effect: Code loses all repo read/write via the GitHub MCP.

### Layer 4 — Stop the session

1. Close the active Claude Code session in the web UI.
2. Effect: any in-flight work is interrupted.

After a kill-switch event, the Operator decides whether and how to restore
access. Restoration follows the original stage sequence — credentials are
re-issued, secrets re-populated, and a new session verifies the setup
end-to-end before any further work.

---

## 8. Audit trail expectations

Every action Code takes is recoverable from one or more of these sources.
The Operator should be able to reconstruct, after the fact, what changed
and on whose authority.

### 8.1 Git

- Every commit Code authors ends with the Claude Code session URL
  (`https://claude.ai/code/session_<id>`). The Operator can open the URL
  to see the full transcript that produced the commit.
- Branches are namespaced under `claude/...`. Direct pushes to `main` are
  not Code's responsibility — `main` only changes via PR merge by the
  Operator.

### 8.2 GitHub

- The GitHub App installation logs every API call Code makes (PR create,
  comment, push, etc.) in the repo's audit log. Visible at
  `https://github.com/kpunches/Staged-Human-In-Loop-CODA-Importer/settings/audit-log`
  (or the personal account audit log).

### 8.3 Postgres (Stage 1+)

What Postgres can attribute to the `claude_code` role depends on which
audit infrastructure is enabled on the database. Render's managed
Postgres does not enable any of the high-resolution options by default;
configuring them is a Stage 1 deliverable (see [§4](#4-rollout-status)).

**Always available (no configuration required):**

- `pg_stat_activity` shows currently-connected sessions with `usename`.
  Useful for spotting Code-attributed connections in real time, not for
  historical audit.
- Render's database "Logs" tab in the dashboard captures connection
  events and errors. Coverage of individual queries depends on
  server-side settings (see below).

**Requires the `pg_stat_statements` extension:**

- Aggregate per-query statistics, attributed by `userid` (which maps to
  the role), accumulated since the extension was loaded. Enabled with
  `CREATE EXTENSION pg_stat_statements;` once `shared_preload_libraries`
  includes it. Render exposes this on most paid plans; on the free plan,
  availability should be verified before relying on it.

**Requires server-side logging configuration:**

- Statement-level logging — every query, with role attribution — needs
  `log_statement = 'all'` (or `'mod'` for writes only). Volume is high.
  Render allows this via plan-level controls; what is configurable
  depends on the current plan.
- Connection lifecycle logging — `log_connections = on` and
  `log_disconnections = on` — attributes session opens and closes to
  roles. Volume is much lower than statement logging and is the
  minimum useful baseline.

**Stage 1 setup procedure (the Operator does this; Code does not):**

These steps are run after the Stage 1 PR is merged and `scripts/setup/create-claude-code-role.sql`
has been applied, but before the Stage 1 gate is declared met.

1. **Confirm `pg_stat_statements` is in `shared_preload_libraries`.**
   - In the Render dashboard for `wgu-staging-db`, open the database's
     settings page and look for advanced Postgres parameters (the exact
     UI label varies by Render plan). Render's paid plans typically
     include `pg_stat_statements` in `shared_preload_libraries` by
     default; the free plan may not expose this control at all.
   - If the parameter is not configurable on the current plan, skip to
     step 5 and document the gap.

2. **Enable the `pg_stat_statements` extension** (assuming step 1
   succeeded):
   - As master:
     ```sh
     psql "$MASTER_DATABASE_URL" \
       -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
     ```
   - Verify:
     ```sh
     psql "$MASTER_DATABASE_URL" \
       -c "SELECT count(*) FROM pg_stat_statements;"
     ```
     should succeed (the count starts at 0 or low).

3. **Enable connection-lifecycle logging.** This is the minimum useful
   audit baseline and is much lower volume than statement logging.
   - Render dashboard → `wgu-staging-db` → settings → set
     `log_connections = on` and `log_disconnections = on`. Render may
     require a service restart for these to take effect.

4. **Statement-level logging (optional, plan-dependent).** Volume is
   high; only enable if the plan exposes the parameter and the Operator
   wants every-query attribution.
   - Set `log_statement = 'mod'` (writes only) or `'all'` (everything).

5. **Record the result in the Stage 1 PR description.** Include:
   - Which of the three audit levels above were enabled.
   - Which were unavailable on the current plan, if any.
   - Any decisions to defer audit upgrades, with reasoning.

   The Stage 1 audit baseline is whatever was achievable here. If it is
   lower than what compliance or operational-incident response would
   require, that is a known gap to either upgrade the plan to address
   or document explicitly as accepted risk.

**Mutations to production** are made by the Operator using master
credentials, not by Code. They appear in whatever audit data the
database is configured to capture above, attributed to the master role.

### 8.4 Render (Stage 5+)

- Render's audit log records deploys, env-var changes, and admin actions.
  Code-initiated deploys (via MCP) appear with the API token's name as
  the actor; Operator actions appear with the Operator's GitHub account.

### 8.5 Claude Code session transcripts

Session URLs (`https://claude.ai/code/session_<id>`) are accessible to
the Operator as the Anthropic account holder. They are **not** accessible
to third-party auditors, and Anthropic provides no documented retention
guarantee for them. They are not portable evidence and they are not
under the Operator's direct control.

Treat session transcripts as a **supplementary** audit record only. The
primary audit evidence for any Code-initiated action lives in the
systems documented above:

- [§8.1 Git](#81-git) — commit content, authorship, and timing.
- [§8.2 GitHub](#82-github) — branch, PR, push, and comment activity.
- [§8.3 Postgres](#83-postgres-stage-1) — query and connection
  attribution, subject to the audit configuration enabled in Stage 1.
- [§8.4 Render](#84-render-stage-5) — deploys, env-var changes, and
  service-level admin actions, once Stage 5 lands.

For any compliance-critical action, the audit story must be complete
**without** the session URL. If you cannot reconstruct what happened
from the systems in 8.1–8.4 alone, the audit story is incomplete and
needs to be strengthened before that action class is repeated. The
session transcript may add useful context — _why_ Code took an action,
_what_ the conversation looked like — but it should not be the sole
evidence for anything that matters.

---

## 9. Change control for this document

This document is the contract. Changes to it are themselves a governance
event:

- Any non-trivial revision (adding or removing a capability, changing a
  rotation procedure, modifying the kill-switch) lands as part of a stage
  PR. The PR description must reference the relevant stage.
- Trivial revisions (typo fixes, clarifications that don't change meaning)
  may land as standalone PRs. They must still be reviewed by the Operator.
- The "Last revised" date at the top of the file is updated on every
  meaningful change.
- Old versions are recoverable from git history.
