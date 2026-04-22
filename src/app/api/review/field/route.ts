import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { prisma } from "@/lib/db"
import { z } from "zod"

const schema = z.object({
  reviewId: z.string(),
  recordId: z.string(),
  fieldName: z.string(),
  status: z.enum(["APPROVED", "FLAGGED", "EDITED"]),
  note: z.string().optional(),
  editedValue: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 })

  const { reviewId, recordId, fieldName, status, note, editedValue } = parsed.data

  // Verify the review belongs to this user's tenant
  const review = await prisma.review.findFirst({
    where: { id: reviewId, tenantId: session.user.tenantId },
  })
  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Upsert the field approval
  await prisma.fieldApproval.upsert({
    where: { reviewId_recordId_fieldName: { reviewId, recordId, fieldName } },
    create: { reviewId, recordId, fieldName, status, note, editedValue, userId: session.user.id },
    update: { status, note, editedValue, userId: session.user.id },
  })

  // Write audit log
  await prisma.auditLog.create({
    data: {
      reviewId,
      userId: session.user.id,
      action: `field.${status.toLowerCase()}`,
      detail: { recordId, fieldName, note, editedValue },
    },
  })

  // Update review status to IN_REVIEW on first interaction
  if (review.status === "PENDING") {
    await prisma.review.update({
      where: { id: reviewId },
      data: { status: "IN_REVIEW" },
    })
  }

  return NextResponse.json({ ok: true })
}
