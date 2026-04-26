"use client"

import { useState, useEffect, useCallback } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "ID" | "EPD" | "AD" | "ADMIN"
type FieldStatusValue = "PENDING" | "APPROVED" | "FLAGGED" | "EDITED"
type ReviewStatusValue = "PENDING" | "IN_REVIEW" | "CHANGES_NEEDED" | "APPROVED" | "WRITTEN" | "FAILED"
type WorkflowTypeValue = "CCW" | "SSD" | "VS" | "SCOPE_TABLE" | "LR" | "PDOW"

interface FieldApproval {
  id: string
  reviewId: string
  recordId: string
  fieldName: string
  status: FieldStatusValue
  note: string | null
  editedValue: string | null
}

interface ReviewSummary {
  id: string
  sourceFileName: string
  workflowType: WorkflowTypeValue
  status: ReviewStatusValue
  courseCode: string | null
  programCode: string
  createdAt: string
  submitter: { name: string | null; email: string }
  fieldApprovals: FieldApproval[]
}

interface ReviewDetail extends ReviewSummary {
  docId: string
  docHash: string | null
  sourceUrl: string
  extractionUrl: string
}

interface ExtractionField {
  field_name: string
  coda_column_id: string
  raw_text: string
  value_md: string
  value_for_coda: string | number
  formatting_fingerprint: Record<string, boolean>
  source_location: Record<string, unknown>
  hyperlinks: string[]
}

interface ExtractionRecord {
  record_id: string
  target_table: string
  fields: ExtractionField[]
}

interface ExtractionJson {
  source_file: string
  pipeline: string
  records: ExtractionRecord[]
}

interface CurrentUser {
  id: string
  email: string
  name?: string | null
  role: UserRole
  tenantId: string
  tenant: { name: string; slug: string }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ReviewStatusValue, { bg: string; color: string; label: string }> = {
  PENDING:        { bg: "#fef9c3", color: "#854d0e", label: "Pending" },
  IN_REVIEW:      { bg: "#dbeafe", color: "#1e40af", label: "In review" },
  CHANGES_NEEDED: { bg: "#ffedd5", color: "#9a3412", label: "Changes needed" },
  APPROVED:       { bg: "#dcfce7", color: "#166534", label: "Approved" },
  WRITTEN:        { bg: "#f0fdf4", color: "#15803d", label: "Written to Coda ✓" },
  FAILED:         { bg: "#fee2e2", color: "#991b1b", label: "Coda write failed" },
}

const WORKFLOW_LABELS: Record<WorkflowTypeValue, string> = {
  CCW: "CCW", SSD: "SSD", VS: "V&S",
  SCOPE_TABLE: "Scope Table", LR: "Learning Resources", PDOW: "PDOW",
}

type FieldKey = `${string}::${string}`
type EditMap = Record<FieldKey, string>
type EditingMap = Record<FieldKey, boolean>

function Toast({ msg, type }: { msg: string; type: "success" | "error" }) {
  return (
    <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", padding: "12px 28px", borderRadius: 10, background: type === "success" ? "#15803d" : "#b91c1c", color: "#fff", fontSize: "14px", fontWeight: "500", boxShadow: "0 4px 16px rgba(0,0,0,0.25)", zIndex: 9999, whiteSpace: "nowrap" }}>
      {msg}
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function UnifiedDashboard({ reviews: initialReviews, currentUser }: {
  reviews: ReviewSummary[]
  currentUser: CurrentUser
}) {
  const [reviews, setReviews] = useState<ReviewSummary[]>(initialReviews)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [extraction, setExtraction] = useState<ExtractionJson | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [editMap, setEditMap] = useState<EditMap>({})        // current edited values
  const [editingMap, setEditingMap] = useState<EditingMap>({}) // which fields are in edit mode
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)

  const canApprove = currentUser.role === "AD" || currentUser.role === "ADMIN"

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // Load review detail + extraction when selection changes
  useEffect(() => {
    if (!selectedId) return
    setLoadingDetail(true)
    setDetail(null)
    setExtraction(null)
    setEditMap({})
    setEditingMap({})

    fetch(`/api/reviews/${selectedId}`)
      .then(r => r.json())
      .then(async (d: ReviewDetail) => {
        setDetail(d)
        // Pre-populate editMap with any previously saved edited values
        const edits: EditMap = {}
        for (const a of d.fieldApprovals ?? []) {
          if (a.status === "EDITED" && a.editedValue) {
            edits[`${a.recordId}::${a.fieldName}` as FieldKey] = a.editedValue
          }
        }
        setEditMap(edits)
        const extrRes = await fetch(d.extractionUrl)
        const extrData: ExtractionJson = await extrRes.json()
        setExtraction(extrData)
      })
      .catch(() => showToast("Failed to load review.", "error"))
      .finally(() => setLoadingDetail(false))
  }, [selectedId])

  // Save a single field edit to the DB
  const saveFieldEdit = useCallback(async (recordId: string, fieldName: string, value: string) => {
    if (!selectedId) return
    await fetch("/api/review/field", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: selectedId, recordId, fieldName, status: "EDITED", editedValue: value }),
    })
  }, [selectedId])

  // Approve all fields at once then push to Coda
  async function handlePushToCoda() {
    if (!extraction || !selectedId) return
    setSubmitting(true)

    // First: approve all fields that haven't been explicitly flagged
    const approvePromises: Promise<unknown>[] = []
    for (const record of extraction.records ?? []) {
      for (const field of record.fields ?? []) {
        const key: FieldKey = `${record.record_id}::${field.field_name}`
        const editedValue = editMap[key]
        approvePromises.push(
          fetch("/api/review/field", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reviewId: selectedId,
              recordId: record.record_id,
              fieldName: field.field_name,
              status: editedValue ? "EDITED" : "APPROVED",
              editedValue: editedValue ?? null,
            }),
          })
        )
      }
    }
    await Promise.all(approvePromises)

    // Then: trigger the Coda write
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: selectedId }),
    })
    setSubmitting(false)

    if (res.ok) {
      showToast("Pushing to Coda… status will update shortly.", "success")
      setReviews(prev => prev.map(r => r.id === selectedId ? { ...r, status: "APPROVED" } : r))
    } else {
      const err = await res.json()
      showToast(err.error ?? "Push failed.", "error")
    }
  }

  const selectedReview = reviews.find(r => r.id === selectedId)

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif", background: "#f5f4f0", overflow: "hidden" }}>

      {/* ── LEFT: Review list ─────────────────────────────────────────────── */}
      <div style={{ width: "260px", flexShrink: 0, borderRight: "1px solid #d0cfc8", overflowY: "auto", background: "#fff", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ padding: "16px", borderBottom: "1px solid #f0efe8", background: "#002855", flexShrink: 0 }}>
          <div style={{ color: "#fff", fontSize: "14px", fontWeight: "600" }}>WGU Document Staging</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px", marginTop: 2 }}>
            {currentUser.tenant.name} · {currentUser.role}
          </div>
        </div>
        <div style={{ padding: "10px 14px 6px", borderBottom: "1px solid #f0efe8" }}>
          <div style={{ fontSize: "10px", fontWeight: "600", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.6px" }}>
            Reviews ({reviews.length})
          </div>
        </div>

        {reviews.length === 0 && (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "#bbb", fontSize: "13px" }}>
            No reviews yet
          </div>
        )}

        {reviews.map(r => {
          const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.PENDING
          const isSelected = r.id === selectedId
          return (
            <div
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              style={{ padding: "11px 14px", borderBottom: "1px solid #f5f4f0", cursor: "pointer", background: isSelected ? "#eff6ff" : "transparent", borderLeft: isSelected ? "3px solid #002855" : "3px solid transparent" }}
            >
              <div style={{ fontSize: "12px", fontWeight: "500", color: "#1a1a1a", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.sourceFileName}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                <span style={{ fontSize: "10px", color: "#888" }}>{WORKFLOW_LABELS[r.workflowType]}</span>
                {r.courseCode && <span style={{ fontSize: "10px", color: "#888" }}>· {r.courseCode}</span>}
                <span style={{ padding: "1px 6px", borderRadius: 999, background: s.bg, color: s.color, fontSize: "9px", fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.3px" }}>
                  {s.label}
                </span>
              </div>
              <div style={{ fontSize: "10px", color: "#ccc", marginTop: 3 }}>
                {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── RIGHT: Review detail ──────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedId && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#bbb", fontSize: "14px" }}>
            ← Select a review to begin
          </div>
        )}

        {selectedId && loadingDetail && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "#bbb", fontSize: "14px" }}>
            Loading…
          </div>
        )}

        {selectedId && !loadingDetail && detail && (
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

            {/* Center: metadata + fields */}
            <div style={{ width: "50%", borderRight: "1px solid #d0cfc8", display: "flex", flexDirection: "column", overflow: "hidden" }}>

              {/* Metadata header */}
              <div style={{ padding: "16px 20px", background: "#fff", borderBottom: "1px solid #e8e7e0", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontSize: "15px", fontWeight: "600", color: "#1a1a1a" }}>{detail.sourceFileName}</div>
                    <div style={{ fontSize: "12px", color: "#888", marginTop: 2 }}>
                      {WORKFLOW_LABELS[detail.workflowType]}
                      {detail.programCode && ` · ${detail.programCode}`}
                      {detail.courseCode && ` · ${detail.courseCode}`}
                      {" · "}Doc: <span style={{ fontFamily: "monospace" }}>{detail.docId}</span>
                    </div>
                  </div>
                  <span style={{ padding: "3px 10px", borderRadius: 999, fontSize: "11px", fontWeight: "600", background: STATUS_STYLES[detail.status]?.bg, color: STATUS_STYLES[detail.status]?.color }}>
                    {STATUS_STYLES[detail.status]?.label}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "#aaa" }}>
                  Submitted {new Date(detail.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  {detail.submitter?.name ? ` by ${detail.submitter.name}` : ""}
                  {detail.docHash && <span style={{ marginLeft: 8, fontFamily: "monospace" }}>SHA: {detail.docHash.slice(0, 10)}…</span>}
                </div>
              </div>

              {/* Field list */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {(extraction?.records ?? []).map(record => (
                  <div key={record.record_id} style={{ borderBottom: "2px solid #f0efe8" }}>
                    {/* Record header */}
                    <div style={{ padding: "8px 20px 6px", background: "#f8f7f5", borderBottom: "1px solid #ede9e4" }}>
                      <span style={{ fontSize: "10px", fontWeight: "700", color: "#666", textTransform: "uppercase", letterSpacing: "0.6px" }}>
                        {record.record_id}
                      </span>
                      <span style={{ marginLeft: 8, fontSize: "10px", color: "#bbb" }}>→ {record.target_table}</span>
                    </div>

                    {/* Fields */}
                    {(record.fields ?? []).map(field => {
                      const key: FieldKey = `${record.record_id}::${field.field_name}`
                      const isEditing = editingMap[key] ?? false
                      const displayValue = editMap[key] ?? field.raw_text

                      return (
                        <div key={field.field_name} style={{ padding: "12px 20px", borderBottom: "1px solid #f5f4f0" }}>
                          {/* Field label */}
                          <div style={{ fontSize: "10px", fontWeight: "600", color: "#999", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 5 }}>
                            {field.field_name}
                            {editMap[key] && <span style={{ marginLeft: 6, color: "#d97706", fontWeight: "500" }}>· edited</span>}
                          </div>

                          {/* Field value — textarea when editing, text when not */}
                          {isEditing ? (
                            <textarea
                              autoFocus
                              value={editMap[key] ?? field.raw_text}
                              onChange={e => setEditMap(prev => ({ ...prev, [key]: e.target.value }))}
                              rows={Math.max(3, Math.ceil((displayValue?.length ?? 0) / 80))}
                              style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "2px solid #002855", fontSize: "13px", lineHeight: "1.5", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box", outline: "none", color: "#1a1a1a" }}
                            />
                          ) : (
                            <div style={{ fontSize: "13px", color: displayValue ? "#1a1a1a" : "#ccc", lineHeight: "1.6", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                              {displayValue || "—"}
                            </div>
                          )}

                          {/* Edit / Save button */}
                          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                            {isEditing ? (
                              <button
                                onClick={async () => {
                                  const val = editMap[key] ?? field.raw_text
                                  await saveFieldEdit(record.record_id, field.field_name, val)
                                  setEditingMap(prev => ({ ...prev, [key]: false }))
                                  showToast("Saved.", "success")
                                }}
                                style={{ padding: "4px 12px", borderRadius: 5, background: "#002855", border: "none", color: "#fff", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}
                              >
                                Save
                              </button>
                            ) : (
                              <button
                                onClick={() => setEditingMap(prev => ({ ...prev, [key]: true }))}
                                style={{ padding: "4px 12px", borderRadius: 5, background: "#f0efe8", border: "1px solid #ddd", color: "#555", fontSize: "12px", cursor: "pointer" }}
                              >
                                Edit
                              </button>
                            )}
                            {isEditing && (
                              <button
                                onClick={() => {
                                  setEditingMap(prev => ({ ...prev, [key]: false }))
                                  setEditMap(prev => { const n = { ...prev }; delete n[key]; return n })
                                }}
                                style={{ padding: "4px 12px", borderRadius: 5, background: "transparent", border: "1px solid #ddd", color: "#888", fontSize: "12px", cursor: "pointer" }}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}

                {/* Push to Coda button */}
                {canApprove && extraction && (
                  <div style={{ padding: "20px", borderTop: "2px solid #e8e7e0", background: "#fafaf8" }}>
                    <button
                      onClick={handlePushToCoda}
                      disabled={submitting || detail.status === "WRITTEN"}
                      style={{ width: "100%", padding: "12px", borderRadius: 8, background: detail.status === "WRITTEN" ? "#dcfce7" : submitting ? "#aaa" : "#002855", border: "none", color: detail.status === "WRITTEN" ? "#15803d" : "#fff", fontSize: "14px", fontWeight: "600", cursor: submitting || detail.status === "WRITTEN" ? "not-allowed" : "pointer", letterSpacing: "-0.2px" }}
                    >
                      {detail.status === "WRITTEN" ? "✓ Written to Coda" : submitting ? "Pushing to Coda…" : "Push to Coda →"}
                    </button>
                    {!canApprove && (
                      <div style={{ marginTop: 8, fontSize: "11px", color: "#aaa", textAlign: "center" }}>
                        Only AD or ADMIN roles can push to Coda
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right: source document */}
            <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#2c2c2a" }}>
              <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                <span style={{ color: "rgba(255,255,255,0.45)", fontSize: "12px" }}>
                  Source — {detail.sourceFileName}
                </span>
              </div>
              <iframe
                src={detail.sourceUrl}
                style={{ flex: 1, border: "none", background: "#fff" }}
                title="Source document"
              />
            </div>
          </div>
        )}
      </div>

      {toast && <Toast msg={toast.msg} type={toast.type} />}
    </div>
  )
}
