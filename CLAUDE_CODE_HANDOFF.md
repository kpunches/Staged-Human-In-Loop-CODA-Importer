# Claude Code Handoff: Coda Importer v2 Architecture

> **IMPORTANT — READ THIS WRAPPER FIRST**
>
> This document was drafted in Claude.ai chat under the assumption that the existing repo had a bad architecture and needed to be rebuilt from scratch. After drafting, the user shared the actual repo (`kpunches/Staged-Human-In-Loop-CODA-Importer`) and it turns out the repo already contains substantial well-architected work: a Next.js review app, Postgres + Prisma database, magic-link auth via Resend, Cloudflare R2 file storage, role-based approval (ID/EPD/AD/ADMIN), and a Python helper script that wires the pipeline to the staging app.
>
> **Do not follow Section 4 (Repository Strategy) literally.** The "delete everything in v2" instructions are obsolete. The repo should be treated as a starting point that needs additions, not a rebuild.
>
> **Treat this document as architectural context, not as a build script.** The principles in it — pure Python on the data path, read-back verification, hash-chained audit log, confidence scoring, risk tiering, the known Coda MCP gotchas in Section 3 — are all still correct and load-bearing. What's wrong is the framing that the repo needs to be torn down.
>
> **Your first action is not to execute this plan. Your first action is to read the existing repo and report what's there:**
>
> 1. Read `README.md` in full
> 2. Walk every file in `src/` and read enough of each to understand its role
> 3. Read `prisma/schema.prisma` in full
> 4. Read every file in `scripts/`
> 5. Read `render.yaml` and `package.json`
> 6. Then produce a written report covering:
>    - What is already built (auth, review UI, database, file storage, deployment, etc.)
>    - What is missing relative to the architecture in this document (read-back verifier, certification workflow, hash-chained audit log, junction integrity checks, confidence scoring, risk-tier routing, pure-Python extractors)
>    - **Where the LLM currently sits in the data path, if anywhere.** The README mentions `ANTHROPIC_API_KEY` and an "AI loader" — flag every place this is invoked and whether it's on the data path or in an advisory role.
>    - Any code patterns that conflict with the principles in Section 2 (LLM-in-data-path, fabricated content fallbacks, smart placeholder filling)
>    - A proposed gap-analysis plan: what to add, what to modify, what to leave alone
>
> Do not modify any files during this read pass. Do not branch, tag, or commit. Just read and report.
>
> Once the user sees your report, they will give you direction on what to build next. The architecture in this document is the target; the report tells us how far the existing repo gets us toward that target.

---

**Read this entire document before writing any code.** It is the result of an extended architecture conversation in Claude.ai chat and represents decisions that have been validated with the user. Do not relitigate the architecture without the user's explicit consent. Treat this as the architectural reference; defer to the wrapper above for what to actually do first.

---

## 1. Context

The user is rebuilding a document import pipeline that extracts structured content from CCW, SSD, V&S/PDVS, scope table, LR, and PDOW files (PDF and DOCX) and loads it into a live Coda doc (ID `4YIajnJqvo`, "Design & Development V3").

The previous architecture had LLMs in the data extraction and write paths. That architecture is being abandoned because it cannot satisfy the user's three priorities:

1. Reviewer time
2. No incorrect data in the live Coda doc
3. Audit requirements (accreditation-relevant content)

The new architecture is **pure Python on the data path, LLM as advisor only**, with a two-paned human-in-the-loop artifact for content review and post-write read-back verification instead of a staging Coda doc.

---

## 2. Architecture Summary

### Core Principle

The LLM never touches data flowing into Coda. Python parses, Python validates, Python writes, Python verifies. The LLM helps the operator (the user) with schema mapping, error explanation, and reviewer Q&A — but every byte that lands in Coda is the deterministic output of a Python function that can be re-run and produce identical output.

### Pipeline (linear, pure Python except where noted)

1. **Source document** (PDF or DOCX) lands on disk
2. **Python extractor** parses the file, attaches a confidence score and risk tier to every extracted field
3. **QA module** independently re-reads the source and does a character-level diff against the extraction
4. **Router** splits fields into `needs_review` (high-risk OR low-confidence) and `auto_approve` (low-risk AND high-confidence)
5. **Two-paned artifact** (React, runs in Claude.ai or as a standalone web app) shows source PDF on the right, extracted JSON on the left. Reviewer edits and approves `needs_review` fields. Auto-approved fields show as a small spot-check sample.
6. **Preflight** validates every column ID, lookup row reference, and select-list value against the live Coda schema via MCP. Fails closed.
7. **Certification check**: if the doc type has never been imported successfully before, OR if the schema has changed since last certification, route through one-time staging. Otherwise skip directly to live write.
8. **Live write** via Coda MCP, using batch APIs where available for atomicity
9. **Read-back verification**: re-query the rows just written, character-level diff against approved JSON, junction integrity check. On mismatch, auto-rollback and flag for human review.
10. **Audit log** captures every step in a hash-chained append-only log

### Confidence That Clean Data Lands In Live

With this architecture: **97-98%** for certified doc types. The residual ~2-3% is irreducible without staging — it covers rare rendering quirks where the data is correct but Coda renders it unexpectedly. Read-back verification catches most of these; the certification gate catches the rest on first contact with a new doc type.

---

## 3. Known Coda MCP Weaknesses And Fixes

These are findings from the prior implementation that must be carried forward. Do not rediscover them.

### Junction Table Writes

**Weakness**: Writing a parent row + children + linking junction rows has an ordering dependency. If the parent write succeeds and a junction write fails silently, the live doc has orphaned data and no error is raised.

**Fix**: After every write that touches junction tables, the verifier module queries each junction table and confirms expected row count and link integrity. Use Coda's batch APIs where available so parent + children + junctions either all commit or all fail. Where batch APIs are not available, the writer must capture the parent write receipt before attempting children; if any child fails, the writer must explicitly delete the orphaned parent before raising.

### Markdown Rendering In Cells

**Weakness**: Markdown that looks fine in JSON sometimes renders as plain text in a Coda canvas cell because of column-type quirks. Preflight cannot catch this — the JSON validates, but the rendered output is wrong.

**Fix**: This is exactly what read-back verification catches. The verifier compares the *re-read* cell content against the approved JSON. The first time a doc type is imported, the certification gate forces a human to visually confirm rendering before auto-approving the doc type for future runs.

### Hyperlink Preservation

**Weakness**: Hyperlinks survive extraction (python-docx exposes them) but get stripped on write if the writer passes plain text instead of markdown links.

**Fix**: The writer module must convert hyperlinks to Coda's accepted markdown link format `[text](url)` before sending. This is in the `coda-mcp-patterns` skill — reference it. Do not skip this step.

### Lookup Row Resolution

**Weakness**: A lookup column can accept a row ID that looks valid but points at the wrong record (or a deleted record). The write succeeds; the lookup resolves to garbage.

**Fix**: Preflight must explicitly resolve every lookup row ID against the live target table and confirm the referenced row exists AND has the expected display value. The expected display value lives in the schema config alongside the row ID.

### Select-List Drift

**Weakness**: Coda select lists can be edited in the live doc. A select value that was valid yesterday may not be valid today.

**Fix**: Preflight pulls the current select-list options for each select column on every run and validates the proposed write value against the *live* options, not a cached config. If a select value has been removed, preflight fails closed.

### Schema Drift Between Preflight And Write

**Weakness**: Someone modifies the live Coda schema in the seconds between preflight passing and the write executing. Preflight's validation is now stale.

**Fix**: For high-risk writes, the writer re-checks critical schema invariants (column IDs, target table existence) immediately before sending. This is a cheap second check. Cannot eliminate the race entirely without locking, but reduces the window from minutes to milliseconds.

### Formula Recalculation

**Weakness**: Writing a row can trigger downstream formulas that reference that row. If a formula error occurs in a different table, the original write still succeeded but the doc is in an inconsistent state.

**Fix**: After write, read-back includes a check on any tables flagged in `schema.json` as "downstream of this write." If a downstream formula errored, log it for human review. Do not auto-rollback for this case — the original write is still correct; the downstream issue needs human judgment.

### Whitespace And Newline Handling

**Weakness**: Coda silently normalizes some whitespace patterns on write (collapses multiple newlines, trims trailing spaces). Char-level diff in read-back will fail on these even though the data is semantically correct.

**Fix**: The verifier's diff function must apply the same normalization Coda applies before comparison. The normalization rules are documented in the `coda-mcp-patterns` skill. Reference them; do not invent new normalization.

---

## 4. Repository Strategy

The user has decided to replace the existing repo's contents but preserve history.

### Steps (do these in order, do not deviate)

1. **Tag current `main` as `legacy-architecture`** before any changes. This is the fallback if the rebuild stalls.
2. **Create a `v2` branch off `main`**.
3. **In the `v2` branch, delete everything except `.git/`, `LICENSE`, `README.md`, and the `docs/` directory if it exists**.
4. **Copy the existing SKILL.md files into `v2/docs/legacy-skills/`** before deleting them from their current locations. The skills contain hard-won knowledge about Coda column IDs and MCP patterns. They will be referenced but not used as-is.
5. **The first commit on `v2` after the deletion is `schema.json`**. Everything else is a function of that file.
6. **When `v2` is feature-complete and tested, merge to `main`** as a single squash commit titled `Architecture v2: pure Python extraction with read-back verification`.
7. **Do not delete the `legacy-architecture` tag**. It stays as audit evidence of what existed before.

### What To Preserve From The Old Repo

- Coda column IDs and table grid IDs (these are still valid; the schema hasn't changed yet)
- Lookup row IDs for known reference tables
- MCP call patterns and known-good payload structures
- Test fixture documents (CCW PDFs, SSD DOCXs, etc.) — copy these into `v2/fixtures/`
- The `coda-mcp-patterns` skill content, copied into `v2/docs/coda-patterns.md`

### What Not To Preserve

- Any code that has an LLM in the extraction or write path
- Any "smart fallback" logic that fills in missing fields
- Any test that asserts LLM output shape (these tests are no longer relevant)
- Configuration files referencing OpenAI, Anthropic, or other LLM APIs in the data path

---

## 5. Build Plan

### Phase 0: Lock The Foundation (1-2 days)

Three deliverables, all committed before any extractor code:

#### 0a. `schema.json`

Pull the current Coda schema for every table the importer will touch. Use Coda MCP `tool_search` to load Coda tools, then read every relevant table's column metadata. Output structure:

```json
{
  "doc_id": "4YIajnJqvo",
  "tables": {
    "DG_Courses": {
      "id": "<grid_id>",
      "columns": {
        "Course Code": {
          "id": "<column_id>",
          "type": "text",
          "risk_tier": "high",
          "required": true
        },
        "Lead Designer": {
          "id": "<column_id>",
          "type": "lookup",
          "lookup_table": "<table_id>",
          "risk_tier": "medium",
          "required": false
        }
      }
    }
  },
  "lookups": {
    "<table_id>": {
      "name": "Designers",
      "key_column": "Name",
      "expected_rows": {
        "<row_id>": "Display Name For Validation"
      }
    }
  }
}
```

#### 0b. Risk Tier Mapping

Tag every column in `schema.json` as `high`, `medium`, or `low`:

- **High**: Competency statements, learning outcomes, evidence statements, scope text, anything accreditation-relevant
- **Medium**: Descriptions, supplemental fields, instructor notes
- **Low**: Internal IDs, ordering fields, metadata, timestamps

This is a one-time judgment call. Ask the user to review the tier assignments before committing `schema.json`.

#### 0c. Confidence Scoring Rubric

Add a `confidence_rules` section to `schema.json`:

```json
{
  "confidence_rules": {
    "extraction_methods": {
      "structured_table_cell_native": 1.0,
      "structured_table_cell_ocr": 0.7,
      "prose_regex_match": 0.5,
      "prose_heuristic_fallback": 0.3
    },
    "review_threshold": 0.8,
    "fail_threshold": 0.3
  }
}
```

Any field below `review_threshold` (0.8) routes to artifact regardless of risk tier. Any field below `fail_threshold` (0.3) blocks the import entirely and requires manual extraction.

### Phase 1: Pure Python Core (3-5 days)

Module structure:

```
v2/
├── schema.json
├── extractors/
│   ├── __init__.py
│   ├── base.py          # ExtractedDoc, ExtractedField dataclasses
│   ├── docx.py          # python-docx based extraction
│   ├── pdf.py           # pdfplumber based extraction
│   └── xlsx.py          # openpyxl based extraction
├── qa/
│   ├── __init__.py
│   ├── diff.py          # char-level diff with Coda normalization
│   └── runner.py        # independent re-read and comparison
├── router/
│   ├── __init__.py
│   └── route.py         # confidence + risk tier → review path
├── preflight/
│   ├── __init__.py
│   ├── schema_check.py  # column IDs, types
│   ├── lookup_check.py  # row ID resolution
│   └── select_check.py  # live select-list validation
├── writer/
│   ├── __init__.py
│   ├── batch.py         # atomic batch writes where supported
│   ├── junction.py      # parent + children + linking with rollback
│   └── markdown.py      # hyperlink and formatting conversion
├── verifier/
│   ├── __init__.py
│   ├── readback.py      # post-write read and diff
│   ├── junction_integrity.py
│   └── rollback.py      # auto-rollback on mismatch
├── audit/
│   ├── __init__.py
│   └── log.py           # hash-chained JSONL append
├── orchestrator/
│   ├── __init__.py
│   └── cli.py           # `import-doc <path> <doc-type>`
├── fixtures/             # real source documents for testing
└── tests/
    ├── extractors/
    ├── qa/
    ├── router/
    ├── preflight/
    ├── writer/
    └── verifier/
```

Build modules in this order. Each module gets unit tests with real fixture documents before moving to the next:

1. `extractors/base.py` (dataclasses only)
2. `extractors/docx.py` + tests with one CCW DOCX fixture
3. `qa/diff.py` and `qa/runner.py` + tests against the same fixture
4. `router/route.py` + tests
5. `preflight/*` + integration tests against live Coda (read-only)
6. `audit/log.py` + tests (build this early; everything else writes to it)
7. `writer/*` + tests against a scratch Coda doc (NOT live, NOT staging — a throwaway)
8. `verifier/*` + tests against the same scratch doc
9. `extractors/pdf.py` + tests
10. `extractors/xlsx.py` + tests

### Phase 2: The Two-Paned Artifact (3-4 days)

Build as a React component. The artifact lives in `v2/artifact/` as a standalone Vite or Next.js app, OR as a Claude.ai artifact that the user invokes via chat. Either path is fine; the user can decide based on deployment preference.

Required behavior:

- Display source PDF on the right (use `pdf.js` via the `react-pdf` package)
- Display extracted JSON on the left, grouped by risk tier with confidence scores visible per field
- Allow inline edits with diff highlighting against the original extraction
- Show `needs_review` fields fully expanded; collapse `auto_approve` fields with a "show spot-check sample" button
- Capture reviewer identity (from a sign-in step), edits made, and approval timestamp
- Output a structured JSON blob that the writer module consumes directly

The output schema matters more than the UI. Lock the output schema first, then iterate on UX.

### Phase 3: Certification Workflow (2-3 days)

Build a thin wrapper around the writer that targets a staging Coda doc instead of live. The user must create the staging doc manually — it is a duplicate of the live doc with the same schema. Add a `staging_doc_id` field to `schema.json`.

Add a `certifications.json` file that tracks which doc types have been certified for which schema versions. Structure:

```json
{
  "ccw": {
    "certified": true,
    "schema_version": "2026-04-15",
    "certified_by": "user@example.com",
    "certified_at": "2026-04-20T14:00:00Z"
  },
  "ssd": {
    "certified": false
  }
}
```

When the orchestrator runs, it checks `certifications.json` after preflight. If the doc type is not certified or the schema version has changed, it routes to staging instead of live and prompts the reviewer to certify after visual confirmation.

### Phase 4: End-to-End Integration (3-5 days)

The orchestrator CLI ties it all together:

```bash
import-doc fixtures/sample-ccw.pdf --type ccw
```

The orchestrator:

1. Calls the right extractor based on `--type`
2. Runs QA
3. Calls the router
4. If `needs_review` is non-empty, opens the artifact and waits for approval
5. Runs preflight
6. Checks certification
7. Writes to live (or staging if not certified)
8. Runs read-back verification
9. Writes audit log entries at every step
10. Outputs a final import report

### Phase 5: Hardening (ongoing)

Build a fixture corpus of every doc type variant the user has seen. Run the full pipeline against all of them in CI. Treat any new failure as a missing fixture to add to the corpus.

---

## 6. Working With The User

### What The User Wants From You

- Execution of this plan, not relitigation of the architecture
- Confidence-grounded answers ("this should work because X" or "I'm not sure, let me test it")
- Pushback when something in this document is wrong or unclear in light of what you discover when you start coding
- Concise updates — they have been in this conversation for a long time and do not need re-explanations of decisions already made

### What The User Does Not Want

- LLM-in-the-data-path "shortcuts"
- Fabricated content when source files are ambiguous (fail loud instead)
- Inferred placeholder text where source files have gaps
- Summarization or paraphrasing of source content during extraction

### Decisions Already Made (Do Not Reopen)

- Pure Python on the data path, LLM as advisor only
- Two-paned artifact for content review (not a staging Coda doc as primary gate)
- Read-back verification replaces staging for certified doc types
- One-time staging certification for new doc types or schema changes
- Confidence scoring + risk tier routing
- Hash-chained audit log
- Repo replacement via `v2` branch with `legacy-architecture` tag preserved

### Decisions Still Open

- Whether the artifact lives in Claude.ai or as a standalone web app
- Specific batch API usage patterns (depends on what Coda MCP exposes)
- Exact normalization rules for read-back diff (will surface during build)
- CI/CD platform for fixture testing

---

## 7. First Steps For Claude Code

When you (Claude Code) read this document for the first time:

1. Acknowledge to the user that you have read the handoff and understand the architecture
2. Verify the current state of the repo: is `v2` already branched? Is `legacy-architecture` tagged?
3. Ask the user which Phase 0 deliverable they want to start with: schema export, risk tagging, or confidence rubric
4. Do not start coding extractors before Phase 0 is complete and `schema.json` is committed
5. When you discover something in this document that is wrong or outdated based on the actual repo state, flag it to the user immediately rather than proceeding on stale assumptions

The user has invested significant time getting the architecture right. Honor that work by executing it carefully.

---

*End of handoff document. Next action: confirm understanding with the user, then begin Phase 0.*
