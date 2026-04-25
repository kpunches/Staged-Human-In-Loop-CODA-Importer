import { requireSession } from "@/lib/session"
import { prisma } from "@/lib/db"
import UnifiedDashboard from "@/components/review/UnifiedDashboard"

export default async function DashboardPage() {
  const session = await requireSession()

  const reviews = await prisma.review.findMany({
    where: { tenantId: session.user.tenantId },
    include: { submitter: { select: { name: true, email: true } }, fieldApprovals: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return (
    <UnifiedDashboard
      reviews={reviews.map(r => ({
        id: r.id,
        sourceFileName: r.sourceFileName,
        workflowType: r.workflowType as "CCW" | "SSD" | "VS" | "SCOPE_TABLE" | "LR" | "PDOW",
        status: r.status as "PENDING" | "IN_REVIEW" | "CHANGES_NEEDED" | "APPROVED" | "WRITTEN" | "FAILED",
        courseCode: r.courseCode,
        programCode: r.programCode,
        createdAt: r.createdAt.toISOString(),
        submitter: r.submitter,
        fieldApprovals: r.fieldApprovals,
      }))}
      currentUser={{
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        role: session.user.role as "ID" | "EPD" | "AD" | "ADMIN",
        tenantId: session.user.tenantId,
        tenant: session.user.tenant,
      }}
    />
  )
}
