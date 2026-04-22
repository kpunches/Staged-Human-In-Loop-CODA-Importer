"use client"

import { useState, useEffect, useCallback } from "react"
import type { Review, FieldApproval, AuditLog, User, UserRole } from "@prisma/client"

type ReviewWithRelations = Review & {
  submitter: { name: string | null; email: string }
  fieldApprovals: FieldApproval[]
  auditLogs: (AuditLog & { user: { name: string | null; email: string } })[]
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
  value_for_coda: string
  formatting_fingerprint: Record<string, boolean>
  source_location: Record<string, unknown>
  hyperlinks: string[]
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
}

interface Props {
  review: ReviewWithRelations
  sourceUrl: string
  extractionUrl: string
  currentUser: CurrentUser
}

type FieldKey = `${string}::${string}`
type FieldStatusMap = Record<FieldKey, { status: "PENDING" | "APPROVED" | "FLAGGED" | "EDITED"; note?: string; editedValue?: string }>

export function ReviewSplitScreen({ review, sourceUrl, extractionUrl, currentUser }: Props) {
  const [extraction, setExtraction] = useState<ExtractionJson | null>(null)
  const [fieldStatus, setFieldStatus] = useState<FieldStatusMap>({})
  const [activeField, setActiveField] = useState<FieldKey | null>(null)
  const [flagNote, setFlagNote] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null)

  // Load extraction JSON
  useEffect(() => {
    fetch(extractionUrl)
      .then((r) => r.json())
      .then((data: ExtractionJson) => {
        setExtraction(data)
        // Seed field status from existing DB approvals
        const initial: FieldStatusMap = {}
        for (const approval of review.fieldApprovals) {
          const key: FieldKey = `${approval.recordId}::${approval.fieldName}`
          initial[key] = {
            status: approval.status as "PENDING" | "APPROVED" | "FLAGGED" | "EDITED",
            note: approval.note ?? undefined,
            editedValue: approval.editedValue ?? undefined,
          }
        }
        setFieldStatus(initial)
      })
      .catch(() => setToast({ msg: "Failed to load extraction data.", type: "error" }))
  }, [extractionUrl, review.fieldApprovals])

  const allFields = extraction?.records.flatMap((r) =>
    r.fields.map((f) => ({ recordId: r.record_id, field: f }))
  ) ?? []

  const approvedCount = Object.values(fieldStatus).filter((s) => s.status === "APPROVED" || s.status === "EDITED").length
  const flaggedCount = Object.values(fieldStatus).filter((s) => s.status === "FLAGGED").length
  const totalCount = allFields.length
  const allApproved = totalCount > 0 && approvedCount + flaggedCount === totalCount && flaggedCount === 0

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  async function updateField(recordId: string, fieldName: string, status: "APPROVED" | "FLAGGED" | "EDITED", extra?: { note?: string; editedValue?: string }) {
    const key: FieldKey = `${recordId}::${fieldName}`
    setFieldStatus((prev) => ({ ...prev, [key]: { status, ...extra } }))

    await fetch("/api/review/field", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: review.id, recordId, fieldName, status, ...extra }),
    })
  }

  async function handleApproveAll() {
    if (!extraction) return
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
    if (!allApproved) return
    setSubmitting(true)
    const res = await fetch("/api/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: review.id }),
    })
    setSubmitting(false)
    if (res.ok) {
      showToast("Approved! Writing to Coda now…", "success")
      setTimeout(() => window.location.href = "/dashboard", 2000)
    } else {
      const err = await res.json()
      showToast(err.message ?? "Approval failed.", "error")
    }
  }

  const canFinalApprove = currentUser.role === "AD" || currentUser.role === "ADMIN"

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "'Helvetica Neue', Arial, sans-serif", background: "#f5f4f0" }}>

      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: "56px",
        background: "#002855", borderBottom: "1px solid rgba(255,255,255,0.1)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <a href="/dashboard" style={{ color: "rgba(255,255,255,0.6)", fontSize: "13px", textDecoration: "none" }}>← Dashboard</a>
          <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>
          <span style={{ color: "#fff", fontSize: "14px", fontWeight: "500" }}>{review.sourceFileName}</span>
          <span style={{ padding: "2px 10px", borderRadius: "999px", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: "12px" }}>
            {review.workflowType}
          </span>
        </div>

        {/* Progress + approve button */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <span style={{ color: "rgba(255,255,255,0.7)", fontSize: "13px" }}>
            {approvedCount}/{totalCount} approved
            {flaggedCount > 0 && <span style={{ color: "#fbbf24", marginLeft: "8px" }}>{flaggedCount} flagged</span>}
          </span>

          {!allApproved && (
            <button onClick={handleApproveAll} style={{
              padding: "7px 16px", borderRadius: "7px",
              background: "rgba(255,255,255,0.15)", border: "1px solid rgba(255,255,255,0.25)",
              color: "#fff", fontSize: "13px", fontWeight: "500", cursor: "pointer",
            }}>
              Approve all pending
            </button>
          )}

          {canFinalApprove && (
            <button
              onClick={handleFinalApprove}
              disabled={!allApproved || submitting}
              style={{
                padding: "7px 18px", borderRadius: "7px",
                background: allApproved ? "#16a34a" : "rgba(255,255,255,0.08)",
                border: "none", color: "#fff", fontSize: "13px", fontWeight: "600",
                cursor: allApproved ? "pointer" : "not-allowed",
                opacity: allApproved ? 1 : 0.5,
              }}
            >
              {submitting ? "Writing to Coda…" : "Approved for Coda →"}
            </button>
          )}
        </div>
      </div>

      {/* Split screen body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT: Extracted fields */}
        <div style={{
          width: "50%", borderRight: "1px solid #d0cfc8",
          overflowY: "auto", background: "#fff",
        }}>
          {extraction ? (
            extraction.records.map((record) => (
              <div key={record.record_id} style={{ borderBottom: "1px solid #f0efe8" }}>
                <div style={{ padding: "12px 20px 8px", background: "#fafaf8", borderBottom: "1px solid #f0efe8" }}>
                  <span style={{ fontSize: "11px", fontWeight: "600", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {record.record_id}
                  </span>
                </div>
                {record.fields.map((field) => {
                  const key: FieldKey = `${record.record_id}::${field.field_name}`
                  const fs = fieldStatus[key]
                  const isActive = activeField === key
                  const statusColor = fs?.status === "APPROVED" || fs?.status === "EDITED"
                    ? "#16a34a" : fs?.status === "FLAGGED" ? "#dc2626" : "#d0cfc8"

                  return (
                    <div
                      key={field.field_name}
                      onClick={() => setActiveField(isActive ? null : key)}
                      style={{
                        padding: "14px 20px",
                        borderBottom: "1px solid #f5f4f0",
                        borderLeft: `3px solid ${statusColor}`,
                        cursor: "pointer",
                        background: isActive ? "#f0f7ff" : "transparent",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "11px", fontWeight: "600", color: "#888", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                            {field.field_name}
                          </div>
                          <div style={{ fontSize: "14px", color: "#1a1a1a", lineHeight: "1.5", wordBreak: "break-word" }}>
                            {(fs?.editedValue ?? field.raw_text) || <span style={{ color: "#ccc" }}>—</span>}
                          </div>
                          {fs?.note && (
                            <div style={{ marginTop: "6px", fontSize: "12px", color: "#dc2626", background: "#fef2f2", padding: "4px 8px", borderRadius: "4px" }}>
                              Note: {fs.note}
                            </div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => updateField(record.record_id, field.field_name, "APPROVED")}
                            title="Approve"
                            style={{
                              width: "28px", height: "28px", borderRadius: "6px", border: "none", cursor: "pointer",
                              background: fs?.status === "APPROVED" ? "#dcfce7" : "#f5f4f0",
                              color: fs?.status === "APPROVED" ? "#16a34a" : "#888",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </button>
                          <button
                            onClick={() => {
                              setActiveField(key)
                              setFlagNote(fs?.note ?? "")
                            }}
                            title="Flag"
                            style={{
                              width: "28px", height: "28px", borderRadius: "6px", border: "none", cursor: "pointer",
                              background: fs?.status === "FLAGGED" ? "#fee2e2" : "#f5f4f0",
                              color: fs?.status === "FLAGGED" ? "#dc2626" : "#888",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/>
                              <line x1="4" y1="22" x2="4" y2="15"/>
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Flag note input (expands on active) */}
                      {isActive && (
                        <div style={{ marginTop: "12px" }} onClick={(e) => e.stopPropagation()}>
                          <textarea
                            value={flagNote}
                            onChange={(e) => setFlagNote(e.target.value)}
                            placeholder="Describe the issue…"
                            rows={2}
                            style={{
                              width: "100%", padding: "8px 10px", borderRadius: "6px",
                              border: "1px solid #d0cfc8", fontSize: "13px", resize: "vertical",
                              fontFamily: "inherit", boxSizing: "border-box",
                            }}
                          />
                          <button
                            onClick={() => {
                              updateField(record.record_id, field.field_name, "FLAGGED", { note: flagNote })
                              setActiveField(null)
                            }}
                            style={{
                              marginTop: "6px", padding: "6px 14px", borderRadius: "6px",
                              background: "#dc2626", border: "none", color: "#fff",
                              fontSize: "12px", fontWeight: "600", cursor: "pointer",
                            }}
                          >
                            Save flag
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))
          ) : (
            <div style={{ padding: "60px", textAlign: "center", color: "#aaa", fontSize: "14px" }}>
              Loading extraction data…
            </div>
          )}
        </div>

        {/* RIGHT: Source document */}
        <div style={{ width: "50%", background: "#3d3d3a", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "10px 16px", background: "#2c2c2a", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "12px" }}>
              Source document — {review.sourceFileName}
            </span>
          </div>
          <iframe
            src={sourceUrl}
            style={{ flex: 1, border: "none", background: "#fff" }}
            title="Source document"
          />
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
          padding: "12px 24px", borderRadius: "10px",
          background: toast.type === "success" ? "#15803d" : "#b91c1c",
          color: "#fff", fontSize: "14px", fontWeight: "500",
          boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
          zIndex: 1000,
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
