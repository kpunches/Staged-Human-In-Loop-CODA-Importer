import { cookies } from "next/headers"
import { prisma } from "@/lib/db"
import { redirect } from "next/navigation"

export interface AppSession {
  user: {
    id: string
    email: string
    name: string | null
    role: "ID" | "EPD" | "AD" | "ADMIN"
    tenantId: string
    tenant: { slug: string; name: string }
  }
}

export async function getSession(): Promise<AppSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get("authjs.session-token")?.value
  if (!token) return null

  const session = await prisma.session.findUnique({
    where: { sessionToken: token },
    include: {
      user: {
        include: { tenant: { select: { slug: true, name: true } } },
      },
    },
  })

  if (!session || session.expires < new Date()) return null
  if (!session.user.tenant) return null

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role as "ID" | "EPD" | "AD" | "ADMIN",
      tenantId: session.user.tenantId,
      tenant: session.user.tenant,
    },
  }
}

export async function requireSession(): Promise<AppSession> {
  const session = await getSession()
  if (!session) redirect("/auth/signin")
  return session
}
