import Link from "next/link"
import { requireSession } from "@/lib/session"
import { prisma } from "@/lib/db"

const STATUS_STYLES = {
  PENDING:        { bg: "#fef9c3", color: "#854d0e", label: "Pending" },
  IN_REVIEW:      { bg: "#dbeafe", color: "#1e40af", label: "In review" },
  CHANGES_NEEDED: { bg: "#ffedd5", color: "#9a3412", label: "Changes needed" },
  APPROVED:       { bg: "#dcfce7", color: "#166534", label: "Approved" },
  WRITTEN:        { bg: "#f0fdf4", color: "#15803d", label: "Written to Coda" },
  FAILED:         { bg: "#fee2e2", color: "#991b1b", label: "Coda write failed" },
} as const

const WORKFLOW_LABELS = {
  CCW: "CCW",
  SSD: "SSD",
  VS: "V&S",
  SCOPE_TABLE: "Scope Table",
  LR: "Learning Resources",
  PDOW: "PDOW Mapping",
} as const

export default async function DashboardPage() {
  const session = await requireSession()
  

  const reviews = await prisma.review.findMany({
    where: { tenantId: session.user.tenantId },
    include: { submitter: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "40px 24px", fontFamily: "'Helvetica Neue', Arial, sans-serif" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "32px" }}>
        <div>
          <h1 style={{ margin: "0 0 6px", fontSize: "24px", fontWeight: "700", color: "#1a1a1a", letterSpacing: "-0.5px" }}>
            Document reviews
          </h1>
          <p style={{ margin: 0, color: "#888", fontSize: "14px" }}>
            {session.user.tenant.name} · {session.user.role} · {session.user.email}
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            padding: "10px 20px", borderRadius: "8px", background: "#f0f7ff",
            border: "1px solid #b5d4f4", color: "#185FA5", fontSize: "13px",
          }}>
            Reviews are created by the Claude import pipeline
          </div>
        </div>
      </div>

      {reviews.length === 0 ? (
        <div style={{
          padding: "60px", textAlign: "center", background: "#fafaf8",
          borderRadius: "12px", border: "1px dashed #d0cfc8",
        }}>
          <p style={{ margin: "0 0 8px", color: "#555", fontSize: "16px" }}>No reviews yet</p>
          <p style={{ margin: 0, color: "#aaa", fontSize: "14px" }}>
            Upload a document from Claude to create the first review for your team.
          </p>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: "12px", border: "1px solid #e0dfd8", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ background: "#fafaf8", borderBottom: "1px solid #e0dfd8" }}>
                {["Document", "Type", "Course", "Submitted by", "Date", "Status", ""].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", color: "#888", fontWeight: "500", fontSize: "12px", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {reviews.map((r: typeof reviews[number], i: number) => {
                const statusKey = r.status as keyof typeof STATUS_STYLES
                const workflowKey = r.workflowType as keyof typeof WORKFLOW_LABELS
                const s = STATUS_STYLES[statusKey] ?? STATUS_STYLES.PENDING
                return (
                  <tr key={r.id} style={{ borderBottom: i < reviews.length - 1 ? "1px solid #f0efe8" : "none" }}>
                    <td style={{ padding: "14px 16px", color: "#1a1a1a", fontWeight: "500" }}>{r.sourceFileName}</td>
                    <td style={{ padding: "14px 16px", color: "#555" }}>{WORKFLOW_LABELS[workflowKey] ?? r.workflowType}</td>
                    <td style={{ padding: "14px 16px", color: "#555" }}>{r.courseCode ?? <span style={{ color: "#bbb" }}>—</span>}</td>
                    <td style={{ padding: "14px 16px", color: "#555" }}>{r.submitter.name ?? r.submitter.email}</td>
                    <td style={{ padding: "14px 16px", color: "#888", whiteSpace: "nowrap" }}>
                      {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{
                        display: "inline-block", padding: "3px 10px", borderRadius: "999px",
                        background: s.bg, color: s.color, fontSize: "12px", fontWeight: "500", whiteSpace: "nowrap",
                      }}>
                        {s.label}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px" }}>
                      <Link href={`/review/${r.id}`} style={{ color: "#002855", fontSize: "13px", fontWeight: "500", textDecoration: "none" }}>
                        Review →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
