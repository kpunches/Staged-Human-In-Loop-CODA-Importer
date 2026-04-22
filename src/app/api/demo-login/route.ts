import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { cookies } from "next/headers"

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "wgu.edu"

export async function POST(req: NextRequest) {
  const body = await req.json()
  const email = (body.email ?? "").toLowerCase().trim()

  if (!email.endsWith(`@${ALLOWED_DOMAIN}`)) {
    return NextResponse.json({ error: "Only @wgu.edu addresses are permitted." }, { status: 403 })
  }

  // Find or create user
  let user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    let tenant = await prisma.tenant.findFirst({ where: { slug: "default" } })
    if (!tenant) {
      tenant = await prisma.tenant.create({
        data: { name: "WGU — Default", slug: "default" },
      })
    }
    user = await prisma.user.create({
      data: {
        email,
        name: email.split("@")[0],
        role: "AD",
        tenantId: tenant.id,
      },
    })
  }

  // Create session
  const sessionToken = crypto.randomUUID()
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  })

  // Set cookie
  const cookieStore = await cookies()
  cookieStore.set("authjs.session-token", sessionToken, {
    expires,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  })

  return NextResponse.json({ ok: true })
}

// Keep GET for backward compatibility
export async function GET(req: NextRequest) {
  const secret = process.env.DEMO_BYPASS_SECRET
  if (!secret) return NextResponse.json({ error: "Not available" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const token = searchParams.get("token")
  const email = (searchParams.get("email") ?? "").toLowerCase()

  if (token !== secret || !email) {
    return NextResponse.json({ error: "Invalid" }, { status: 401 })
  }

  const body = await POST(new NextRequest(req.url, {
    method: "POST",
    body: JSON.stringify({ email }),
    headers: { "Content-Type": "application/json" },
  }))

  if (body.ok) {
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }
  return body
}
