import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { downloadJson, uploadJson, extractionKey } from "@/lib/storage"
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const schema = z.object({ reviewId: z.string() })

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Only AD and ADMIN can trigger final approval
  if (session.user.role !== "AD" && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only Academic Directors can approve for Coda." }, { status: 403 })
  }

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const { reviewId } = parsed.data

  const review = await prisma.review.findFirst({
    where: { id: reviewId, tenantId: session.user.tenantId },
    include: { fieldApprovals: true },
  })
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Guard: ensure no fields are flagged or pending
  const blocked = review.fieldApprovals.filter((f) => f.status === "FLAGGED" || f.status === "PENDING")
  if (blocked.length > 0) {
    return NextResponse.json({
      error: `${blocked.length} field(s) are not yet approved. Resolve all flags before approving.`,
    }, { status: 422 })
  }

  // Load extraction JSON from R2
  const extraction = await downloadJson<Record<string, unknown>>(
    extractionKey(review.tenantId, review.id)
  )

  // Merge edited field values + write the human_review block
  const approvals = review.fieldApprovals
  const editedFields = approvals
    .filter((a) => a.status === "EDITED" && a.editedValue)
    .reduce<Record<string, string>>((acc, a) => {
      acc[`${a.recordId}::${a.fieldName}`] = a.editedValue!
      return acc
    }, {})

  // Patch edited values into the extraction records
  const records = (extraction.records as Array<{
    record_id: string
    fields: Array<{ field_name: string; raw_text: string; value_for_coda: string }>
  }>).map((record) => ({
    ...record,
    fields: record.fields.map((field) => {
      const editedValue = editedFields[`${record.record_id}::${field.field_name}`]
      return editedValue
        ? { ...field, raw_text: editedValue, value_for_coda: editedValue, _edited: true }
        : field
    }),
  }))

  const approvedExtraction = {
    ...extraction,
    records,
    human_review: {
      reviewer_name: session.user.name ?? session.user.email,
      reviewer_email: session.user.email,
      reviewer_role: session.user.role,
      approved_at: new Date().toISOString(),
      doc_hash: review.docHash,
      all_fields_approved: true,
      edited_field_count: Object.keys(editedFields).length,
    },
  }

  // Save the approved extraction back to R2
  await uploadJson(extractionKey(review.tenantId, review.id), approvedExtraction)

  // Update review status
  await prisma.review.update({
    where: { id: reviewId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: session.user.id,
    },
  })

  await prisma.auditLog.create({
    data: {
      reviewId,
      userId: session.user.id,
      action: "review.approved",
      detail: { editedFields: Object.keys(editedFields).length },
    },
  })

  // Fire the Coda loader via Anthropic API (non-blocking — runs in background)
  triggerCodaLoader(review, approvedExtraction, reviewId).catch(console.error)

  return NextResponse.json({ ok: true })
}

async function triggerCodaLoader(
  review: { workflowType: string; docId: string; programCode: string; courseCode: string | null },
  extraction: Record<string, unknown>,
  reviewId: string
) {
  const workflowPrompts: Record<string, string> = {
    CCW: "You are running the ccw-coda-import skill.",
    SSD: "You are running the ssd-coda-import skill.",
    VS: "You are running the pdvs-coda-import skill.",
    SCOPE_TABLE: "You are running the es-scope-import skill.",
    LR: "You are running the lr-tools-coda-import skill.",
    PDOW: "You are running the pdow-coda-mapping skill.",
  }

  const systemPrompt = workflowPrompts[review.workflowType] ?? "You are a Coda import assistant."

  const userPrompt = `
Load the following approved extraction JSON into Coda.

Doc ID: ${review.docId}
Program: ${review.programCode}
Course: ${review.courseCode ?? "N/A"}
Workflow: ${review.workflowType}

The human_review block confirms all fields have been approved by a WGU Academic Director.

Extraction JSON:
${JSON.stringify(extraction, null, 2)}

Load all records into the appropriate Coda tables. Follow the ${review.workflowType} import skill exactly.
`

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    })

    const success = response.stop_reason === "end_turn"
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        status: success ? "WRITTEN" : "FAILED",
        codaWrittenAt: success ? new Date() : undefined,
      },
    })

    await prisma.auditLog.create({
      data: {
        reviewId,
        userId: "system",
        action: success ? "coda.written" : "coda.failed",
        detail: { stop_reason: response.stop_reason },
      },
    })
  } catch (err) {
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "FAILED" },
    })
    throw err
  }
}
