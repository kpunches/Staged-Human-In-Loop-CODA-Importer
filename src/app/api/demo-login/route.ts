import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { cookies } from "next/headers"

// Demo-only bypass — disabled in production unless DEMO_BYPASS_SECRET is set
export async function GET(req: NextRequest) {
  const secret = process.env.DEMO_BYPASS_SECRET
  if (!secret) {
    return NextResponse.json({ error: "Not available" }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const token = searchParams.get("token")
  const email = searchParams.get("email")

  if (token !== secret || !email) {
    return NextResponse.json({ error: "Invalid" }, { status: 401 })
  }

  // Find or create the user
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    let tenant = await prisma.tenant.findFirst({ where: { slug: "default" } })
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: "WGU — Default", slug: "default" },
      })
    }
    user = await prisma.user.create({
      data: { email, name: email.split("@")[0], role: "AD", tenantId: tenant.id },
    })
  }

  // Create a NextAuth session token directly
  const sessionToken = crypto.randomUUID()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  })

  // Set the session cookie
  const cookieStore = await cookies()
  cookieStore.set("authjs.session-token", sessionToken, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  })

  return NextResponse.redirect(new URL("/dashboard", req.url))
}
