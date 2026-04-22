import { auth } from "@/lib/auth"
import { redirect, notFound } from "next/navigation"
import { prisma } from "@/lib/db"
import { getSignedDownloadUrl } from "@/lib/storage"
import { ReviewSplitScreen } from "@/components/review/ReviewSplitScreen"

interface ReviewPageProps {
  params: { id: string }
}

export default async function ReviewPage({ params }: ReviewPageProps) {
  const session = await auth()
  if (!session) redirect("/auth/signin")

  const review = await prisma.review.findFirst({
    where: { id: params.id, tenantId: session.user.tenantId },
    include: {
      submitter: { select: { name: true, email: true } },
      fieldApprovals: true,
      auditLogs: {
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  })

  if (!review) notFound()

  // Generate 15-minute signed URLs for both files
  const [sourceUrl, extractionUrl] = await Promise.all([
    getSignedDownloadUrl(review.sourceFileKey),
    getSignedDownloadUrl(review.extractionKey),
  ])

  return (
    <ReviewSplitScreen
      review={review}
      sourceUrl={sourceUrl}
      extractionUrl={extractionUrl}
      currentUser={session.user}
    />
  )
}
