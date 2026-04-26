"use client"

import { useState, useEffect } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = "ID" | "EPD" | "AD" | "ADMIN"
type FieldStatusValue = "PENDING" | "APPROVED" | "FLAGGED" | "EDITED"
type ReviewStatusValue = "PENDING" | "IN_REVIEW" | "CHANGES_NEEDED" | "APPROVED" | "WRITTEN" | "FAILED"
type WorkflowTypeValue = "CCW" | "SSD" | "VS" | "SCOPE_TABLE" | "LR" | "PDOW"

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

interface FieldApproval {
  id: string
  reviewId: string
  recordId: string
  fieldName: string
  status: FieldStatusValue
  note: string | null
  editedValue: string | null
}

interface ExtractionRecord {
  record_id: string
  target_table: string
  fields: ExtractionField[]
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

interface ExtractionJson {
  source_file: string
  pipeline: string
  records: ExtractionRecord[]
}

interface ReviewDetail extends ReviewSummary {
  sourceUrl: string
  extractionUrl: string
}

interface CurrentUser {
  id: string
  email: string
  name?: string | null
  role: UserRole
  tenantId: string
  tenant: { name: string; slug: string }
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ReviewStatusValue, { bg: string; color: string; label: string }> = {
  PENDING:        { bg: "#fef9c3", color: "#854d0e", label: "Pending" },
  IN_REVIEW:      { bg: "#dbeafe", color: "#1e40af", label: "In review" },
  CHANGES_NEEDED: { bg: "#ffedd5", color: "#9a3412", label: "Changes needed" },
  APPROVED:       { bg: "#dcfce7", color: "#166534", label: "Approved" },
  WRITTEN:        { bg: "#f0fdf4", color: "#15803d", label: "Written to Coda" },
  FAILED:         { bg: "#fee2e2", color: "#991b1b", label: "Coda write failed" },
}

const WORKFLOW_LABELS: Record<WorkflowTypeValue, string> = {
  CCW: "CCW", SSD: "SSD", VS: "V&S",
  SCOPE_TABLE: "Scope Table", LR: "Learning Resources", PDOW: "PDOW",
}

type FieldKey = `${string}::${string}`
type FieldStatusMap = Record<FieldKey, { status: FieldStatusValue; note?: string; editedValue?: string }>

// ─── Component ────────────────────────────────────────────────────────────────

export default function UnifiedDashboard({ reviews: initialReviews, currentUser }: {
  reviews: ReviewSummary[]
  currentUser: CurrentUser
}) {
  const [reviews, setReviews] = useState<ReviewSummary[]>(initialReviews)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReviewDetail | null>(null)
  const [extraction, setExtraction] = useState<ExtractionJson | null>(null)
  const [fieldStatus, setFieldStatus] = useState<FieldStatusMap>({})
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [activeField, setActiveField] = useState<FieldKey | null>(null)
  const [flagNote, setFlagNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)

  const canApprove = currentUser.role === "AD" || currentUser.role === "ADMIN"

  // Load review detail when selection changes
  useEffect(() => {
    if (!selectedId) return
    setLoadingDetail(true)
    setExtraction(null)
    setDetail(null)

    fetch(`/api/reviews/${selectedId}`)
      .then(r => r.json())
      .then((d: ReviewDetail) => {
        setDetail(d)
        // Seed field status from existing approvals
        const initial: FieldStatusMap = {}
        for (const a of d.fieldApprovals ?? []) {
          const key: FieldKey = `${a.recordId}::${a.fieldName}`
          initial[key] = { status: a.status, note: a.note ?? undefined, editedValue: a.editedValue ?? undefined }
        }
        setFieldStatus(initial)
        // Fetch extraction JSON
        return fetch(d.extractionUrl).then(r => r.json())
      })
      .then((data: ExtractionJson) => setExtraction(data))
      .catch(() => showToast("Failed to load review.", "error"))
      .finally(() => setLoadingDetail(false))
  }, [selectedId])

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function updateField(recordId: string, fieldName: string, status: "APPROVED" | "FLAGGED" | "EDITED", extra?: { note?: string; editedValue?: string }) {
    if (!selectedId) return
    const key: FieldKey = `${recordId}::${fieldName}`
    setFieldStatus(prev => ({ ...prev, [key]: { status, ...extra } }))
    await fetch("/api/review/field", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: selectedId, recordId, fieldName, status, ...extra }),
    })
  }

  const allFields = (extraction?.records ?? []).flatMap(r =>
    (r.fields ?? []).map(f => ({ recordId: r.record_id, field: f }))
  )
  const approvedCount = Object.values(fieldStatus).filter(s => s.status === "APPROVED" || s.status === "EDITED").length
  const flaggedCount  = Object.values(fieldStatus).filter(s => s.status === "FLAGGED").length
  const totalCount    = allFields.length
  const allApproved   = totalCount > 0 && approvedCount + flaggedCount === totalCount && flaggedCount === 0

  async function handleApproveAll() {
    const updates = allFields
      .filter(({ recordId, field }) => {
        const key: FieldKey = `${recordId}::${field.field_name}`
        return !fieldStatus[key] || fieldStatus[key].status === "PENDING"
      })
      .map(({ recordId, field }) => updateField(recordId, field.field_name, "APPROVED"))
    await Promise.all(updates)
    showToast("All pending fields approved.", "success")
  }

  async function handleFinalApprove() {
    if (!allApproved || !selectedId) return
    setSubmitting(true)
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: selectedId }),
    })
    setSubmitting(false)
    if (res.ok) {
      showToast("Approved! Writing to Coda…", "success")
      setReviews(prev => prev.map(r => r.id === selectedId ? { ...r, status: "APPROVED" } : r))
      setTimeout(() => setSelectedId(null), 2000)
    } else {
      const err = await res.json()
      showToast(err.message ?? "Approval failed.", "error")
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif", background: "#f5f4f0", overflow: "hidden" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 24px", height: "52px", background: "#002855", borderBottom: "1px solid rgba(255,255,255,0.1)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ color: "#fff", fontSize: "15px", fontWeight: "600", letterSpacing: "-0.3px" }}>
            WGU Document Staging
          </span>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "13px" }}>
            {currentUser.tenant.name} · {currentUser.role}
          </span>
        </div>
        {selectedId && (
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ color: "rgba(255,255,255,0.6)", fontSize: "13px" }}>
              {approvedCount}/{totalCount} approved
              {flaggedCount > 0 && <span style={{ color: "#fbbf24", marginLeft: 8 }}>{flaggedCount} flagged</span>}
            </span>
            {!allApproved && totalCount > 0 && (
              <button onClick={handleApproveAll} style={{ padding: "6px 14px", borderRadius: "7px", background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)", color: "#fff", fontSize: "13px", cursor: "pointer" }}>
                Approve all pending
              </button>
            )}
            {canApprove && (
              <button onClick={handleFinalApprove} disabled={!allApproved || submitting} style={{ padding: "6px 16px", borderRadius: "7px", background: allApproved ? "#16a34a" : "rgba(255,255,255,0.08)", border: "none", color: "#fff", fontSize: "13px", fontWeight: "600", cursor: allApproved ? "pointer" : "not-allowed", opacity: allApproved ? 1 : 0.5 }}>
                {submitting ? "Writing to Coda…" : "Approved for Coda →"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Three-panel body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT — Review list */}
        <div style={{ width: "280px", flexShrink: 0, borderRight: "1px solid #d0cfc8", overflowY: "auto", background: "#fff" }}>
          <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid #f0efe8" }}>
            <div style={{ fontSize: "11px", fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Reviews ({reviews.length})
            </div>
          </div>
          {reviews.length === 0 && (
            <div style={{ padding: "32px 16px", textAlign: "center", color: "#aaa", fontSize: "13px" }}>
              No reviews yet
            </div>
          )}
          {reviews.map(r => {
            const s = STATUS_STYLES[r.status] ?? STATUS_STYLES.PENDING
            const isSelected = r.id === selectedId
            return (
              <div key={r.id} onClick={() => setSelectedId(r.id)} style={{ padding: "12px 16px", borderBottom: "1px solid #f5f4f0", cursor: "pointer", background: isSelected ? "#eff6ff" : "transparent", borderLeft: isSelected ? "3px solid #002855" : "3px solid transparent", transition: "background 0.1s" }}>
                <div style={{ fontSize: "13px", fontWeight: "500", color: "#1a1a1a", marginBottom: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.sourceFileName}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: "11px", color: "#888" }}>{WORKFLOW_LABELS[r.workflowType]}</span>
                  {r.courseCode && <span style={{ fontSize: "11px", color: "#888" }}>· {r.courseCode}</span>}
                  <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: "999px", background: s.bg, color: s.color, fontSize: "10px", fontWeight: "500" }}>
                    {s.label}
                  </span>
                </div>
                <div style={{ fontSize: "11px", color: "#bbb", marginTop: 4 }}>
                  {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </div>
            )
          })}
        </div>

        {/* CENTER — Extracted fields */}
        <div style={{ width: "35%", borderRight: "1px solid #d0cfc8", overflowY: "auto", background: "#fff" }}>
          {!selectedId && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#bbb", fontSize: "14px" }}>
              ← Select a review to begin
            </div>
          )}
          {selectedId && loadingDetail && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#bbb", fontSize: "14px" }}>
              Loading…
            </div>
          )}
          {selectedId && !loadingDetail && extraction && (
            (extraction.records ?? []).map(record => (
              <div key={record.record_id} style={{ borderBottom: "1px solid #f0efe8" }}>
                <div style={{ padding: "10px 20px 6px", background: "#fafaf8", borderBottom: "1px solid #f0efe8" }}>
                  <span style={{ fontSize: "10px", fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {record.record_id}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: "10px", color: "#bbb" }}>{record.target_table}</span>
                </div>
                {(record.fields ?? []).map(field => {
                  const key: FieldKey = `${record.record_id}::${field.field_name}`
                  const fs = fieldStatus[key]
                  const isActive = activeField === key
                  const statusColor = fs?.status === "APPROVED" || fs?.status === "EDITED" ? "#16a34a" : fs?.status === "FLAGGED" ? "#dc2626" : "#d0cfc8"
                  return (
                    <div key={field.field_name} onClick={() => setActiveField(isActive ? null : key)} style={{ padding: "12px 20px", borderBottom: "1px solid #f5f4f0", borderLeft: `3px solid ${statusColor}`, cursor: "pointer", background: isActive ? "#f0f7ff" : "transparent" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "10px", fontWeight: "600", color: "#888", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.4px" }}>
                            {field.field_name}
                          </div>
                          <div style={{ fontSize: "13px", color: "#1a1a1a", lineHeight: "1.5", wordBreak: "break-word" }}>
                            {(fs?.editedValue ?? field.raw_text) || <span style={{ color: "#ccc" }}>—</span>}
                          </div>
                          {fs?.note && <div style={{ marginTop: 4, fontSize: "11px", color: "#dc2626", background: "#fef2f2", padding: "3px 7px", borderRadius: 4 }}>Note: {fs.note}</div>}
                        </div>
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => updateField(record.record_id, field.field_name, "APPROVED")} title="Approve" style={{ width: 26, height: 26, borderRadius: 6, border: "none", cursor: "pointer", background: fs?.status === "APPROVED" ? "#dcfce7" : "#f5f4f0", color: fs?.status === "APPROVED" ? "#16a34a" : "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          </button>
                          <button onClick={() => { setActiveField(key); setFlagNote(fs?.note ?? "") }} title="Flag" style={{ width: 26, height: 26, borderRadius: 6, border: "none", cursor: "pointer", background: fs?.status === "FLAGGED" ? "#fee2e2" : "#f5f4f0", color: fs?.status === "FLAGGED" ? "#dc2626" : "#888", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                          </button>
                        </div>
                      </div>
                      {isActive && (
                        <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
                          <textarea value={flagNote} onChange={e => setFlagNote(e.target.value)} placeholder="Describe the issue…" rows={2} style={{ width: "100%", padding: "6px 8px", borderRadius: 6, border: "1px solid #d0cfc8", fontSize: "12px", resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }} />
                          <button onClick={() => { updateField(record.record_id, field.field_name, "FLAGGED", { note: flagNote }); setActiveField(null) }} style={{ marginTop: 4, padding: "5px 12px", borderRadius: 6, background: "#dc2626", border: "none", color: "#fff", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>
                            Save flag
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* RIGHT — Source document */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#3d3d3a" }}>
          <div style={{ padding: "10px 16px", background: "#2c2c2a", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px" }}>
              {detail ? `Source document — ${detail.sourceFileName}` : "Source document"}
            </span>
          </div>
          {!selectedId && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "rgba(255,255,255,0.2)", fontSize: "14px" }}>
              Select a review to see the source document
            </div>
          )}
          {selectedId && !detail && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, color: "rgba(255,255,255,0.3)", fontSize: "14px" }}>
              Loading…
            </div>
          )}
          {detail && (
            <iframe src={detail.sourceUrl} style={{ flex: 1, border: "none", background: "#fff" }} title="Source document" />
          )}
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", padding: "12px 24px", borderRadius: 10, background: toast.type === "success" ? "#15803d" : "#b91c1c", color: "#fff", fontSize: "14px", fontWeight: "500", boxShadow: "0 4px 12px rgba(0,0,0,0.2)", zIndex: 1000 }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
