import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { validateApiToken } from "@/lib/auth/api-token"
import { prisma } from "@/lib/db"
import { uploadFile, uploadJson, sourceFileKey, extractionKey } from "@/lib/storage"
import { z } from "zod"
import crypto from "crypto"

const metaSchema = z.object({
  docId: z.string(),
  programCode: z.string(),
  courseCode: z.string().optional(),
  workflowType: z.enum(["CCW", "SSD", "VS", "SCOPE_TABLE", "LR", "PDOW"]),
  sourceFileName: z.string(),
})

export async function POST(req: NextRequest) {
  let userId: string
  let tenantId: string

  const session = await auth()
  if (session) {
    userId = session.user.id
    tenantId = session.user.tenantId
  } else {
    const tokenUser = await validateApiToken(req)
    if (!tokenUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    userId = tokenUser.userId
    tenantId = tokenUser.tenantId
  }

  const formData = await req.formData()

  // Parse metadata
  const metaRaw = formData.get("meta")
  if (!metaRaw || typeof metaRaw !== "string") {
    return NextResponse.json({ error: "Missing meta field" }, { status: 400 })
  }
  const meta = metaSchema.safeParse(JSON.parse(metaRaw))
  if (!meta.success) return NextResponse.json({ error: "Invalid metadata", detail: meta.error }, { status: 400 })

  // Get files
  const sourceFile = formData.get("sourceFile") as File | null
  const extractionFile = formData.get("extractionJson") as File | null

  if (!sourceFile || !extractionFile) {
    return NextResponse.json({ error: "Missing sourceFile or extractionJson" }, { status: 400 })
  }

  const review = await prisma.review.create({
    data: {
      tenantId,
      docId: meta.data.docId,
      programCode: meta.data.programCode,
      courseCode: meta.data.courseCode,
      workflowType: meta.data.workflowType,
      sourceFileName: meta.data.sourceFileName,
      sourceFileKey: "pending",
      extractionKey: "pending",
      submittedBy: userId,
      status: "PENDING",
    },
  })

  // Upload source file
  const sourceBytes = Buffer.from(await sourceFile.arrayBuffer())
  const docHash = crypto.createHash("sha256").update(sourceBytes).digest("hex")
  const sKey = sourceFileKey(tenantId, review.id, meta.data.sourceFileName)
  await uploadFile(sKey, sourceBytes, sourceFile.type || "application/octet-stream")

  // Upload extraction JSON
  const extractionBytes = await extractionFile.text()
  const extractionData = JSON.parse(extractionBytes)
  const eKey = extractionKey(tenantId, review.id)
  await uploadJson(eKey, extractionData)

  // Update review with actual keys and hash
  await prisma.review.update({
    where: { id: review.id },
    data: { sourceFileKey: sKey, extractionKey: eKey, docHash },
  })

  await prisma.auditLog.create({
    data: {
      reviewId: review.id,
      userId,
      action: "review.created",
      detail: { workflowType: meta.data.workflowType, sourceFileName: meta.data.sourceFileName },
    },
  })

  return NextResponse.json({ reviewId: review.id, url: `/review/${review.id}` })
}
