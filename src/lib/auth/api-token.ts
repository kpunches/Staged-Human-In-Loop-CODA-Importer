import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"

/**
 * Validates a Bearer token from the Authorization header.
 * Tokens are stored as sessions with a special "api-token" prefix.
 *
 * For the demo, we support a single PIPELINE_API_TOKEN env var.
 * In production, replace with a proper token table in Postgres.
 */
export async function validateApiToken(req: NextRequest): Promise<{ userId: string; tenantId: string } | null> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) return null

  const token = authHeader.slice(7).trim()

  // Simple env-var token for demo/pipeline use
  if (process.env.PIPELINE_API_TOKEN && token === process.env.PIPELINE_API_TOKEN) {
    // Return the system pipeline user — must exist in DB
    const pipelineUser = await prisma.user.findFirst({
      where: { email: "pipeline@wgu.edu" },
      select: { id: true, tenantId: true },
    })
    if (pipelineUser) {
      return { userId: pipelineUser.id, tenantId: pipelineUser.tenantId }
    }
    return null
  }

  return null
}
