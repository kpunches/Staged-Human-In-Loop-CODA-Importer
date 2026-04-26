import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/session"
import { prisma } from "@/lib/db"
import { getSignedDownloadUrl } from "@/lib/storage"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params

  const review = await prisma.review.findFirst({
    where: { id, tenantId: session.user.tenantId },
    include: {
      submitter: { select: { name: true, email: true } },
      fieldApprovals: true,
    },
  })

  if (!review) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const [sourceUrl, extractionUrl] = await Promise.all([
    getSignedDownloadUrl(review.sourceFileKey),
    getSignedDownloadUrl(review.extractionKey),
  ])

  return NextResponse.json({ ...review, sourceUrl, extractionUrl })
}
