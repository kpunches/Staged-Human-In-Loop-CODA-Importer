import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { prisma } from "@/lib/db"
import { uploadFile, getSignedUrl, sourceFileKey, extractionKey } from "@/lib/storage"
import { WorkflowType } from "@prisma/client"

function verifyToken(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") ?? ""
  const token = auth.replace(/^Bearer\s+/i, "").trim()
  return token === process.env.PIPELINE_API_TOKEN && token.length > 0
}

const VALID_WORKFLOWS: WorkflowType[] = ["CCW", "SSD", "VS", "SCOPE_TABLE", "LR", "PDOW"]

export async function POST(req: NextRequest) {
  if (!verifyToken(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: FormData
  try {
    body = await req.formData()
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 })
  }

  // Parse meta JSON field (what push_to_staging.py sends)
  let docId: string | null = null
  let programCode: string | null = null
  let courseCode: string | null = null
  let workflowRaw: string | null = null
  let tenantSlug = "wgu"

  const metaRaw = body.get("meta") as string | null
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw)
      docId       = meta.docId        ?? meta.doc_id   ?? null
      programCode = meta.programCode  ?? meta.program  ?? null
      courseCode  = meta.courseCode   ?? meta.course   ?? null
      workflowRaw = meta.workflowType ?? meta.workflow ?? null
      tenantSlug  = meta.tenant       ?? tenantSlug
    } catch {
      return NextResponse.json({ error: "meta field is not valid JSON" }, { status: 400 })
    }
  } else {
    docId       = body.get("doc_id")   as string | null
    programCode = body.get("program")  as string | null
    courseCode  = body.get("course")   as string | null
    workflowRaw = body.get("workflow") as string | null
    tenantSlug  = (body.get("tenant")  as string | null) ?? tenantSlug
  }

  const sourceFile =
    (body.get("sourceFile")      as File | null) ??
    (body.get("source_file")     as File | null)
  const extractJson =
    (body.get("extractionJson")  as File | null) ??
    (body.get("extraction_json") as File | null)

  if (!docId || !programCode || !workflowRaw || !sourceFile || !extractJson) {
    return NextResponse.json(
      { error: "Missing required fields", received: { docId: !!docId, programCode: !!programCode, workflowRaw: !!workflowRaw, sourceFile: !!sourceFile, extractJson: !!extractJson } },
      { status: 400 }
    )
  }

  const workflowType = workflowRaw.toUpperCase() as WorkflowType
  if (!VALID_WORKFLOWS.includes(workflowType)) {
    return NextResponse.json({ error: `Invalid workflow: ${workflowRaw}` }, { status: 400 })
  }

  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } })
  if (!tenant) {
    return NextResponse.json({ error: `Tenant not found: ${tenantSlug}` }, { status: 404 })
  }

  const sourceBuffer  = Buffer.from(await sourceFile.arrayBuffer())
  const extractBuffer = Buffer.from(await extractJson.arrayBuffer())
  const docHash       = createHash("sha256").update(sourceBuffer).digest("hex")

  let extractionData: unknown
  try {
    extractionData = JSON.parse(extractBuffer.toString("utf-8"))
  } catch {
    return NextResponse.json({ error: "extractionJson is not valid JSON" }, { status: 400 })
  }

  const review = await prisma.review.create({
    data: { tenantId: tenant.id, docId, programCode, courseCode: courseCode || null, workflowType, status: "PENDING", sourceFileKey: "pending", extractionKey: "pending", docHash },
  })

  const ext     = sourceFile.name.split(".").pop() ?? "bin"
  const srcKey  = sourceFileKey(tenant.id, review.id, sourceFile.name)
  const extrKey = extractionKey(tenant.id, review.id)

  await uploadFile(srcKey, sourceBuffer, sourceFile.type || "application/octet-stream")
  await uploadFile(extrKey, Buffer.from(JSON.stringify(extractionData, null, 2)), "application/json")

  await prisma.review.update({ where: { id: review.id }, data: { sourceFileKey: srcKey, extractionKey: extrKey } })

  await
