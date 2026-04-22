import { handlers } from "@/lib/auth/config"
import { sendMagicLinkEmail } from "@/lib/email"
import { NextRequest, NextResponse } from "next/server"

// Wrap POST to intercept magic link emails and send via Gmail SMTP
export async function POST(req: NextRequest) {
  // Clone the request so we can read the body
  const cloned = req.clone()
  const response = await handlers.POST(req)

  // After NextAuth processes the sign-in, check if this was an email sign-in
  // and fire our custom email sender
  try {
    const body = await cloned.text()
    const params = new URLSearchParams(body)
    const email = params.get("email")
    const callbackUrl = params.get("callbackUrl") ?? "/"

    if (email && email.includes("@")) {
      // NextAuth has already created the verification token in the DB.
      // We need to query it and send our custom email.
      // This runs after NextAuth's handler so the token exists.
      const { prisma } = await import("@/lib/db")
      const token = await prisma.verificationToken.findFirst({
        where: { identifier: email },
        orderBy: { expires: "desc" },
      })
      if (token) {
        const url = new URL("/api/auth/callback/resend", process.env.NEXTAUTH_URL!)
        url.searchParams.set("token", token.token)
        url.searchParams.set("email", email)
        url.searchParams.set("callbackUrl", callbackUrl)
        await sendMagicLinkEmail({ to: email, magicLinkUrl: url.toString() })
      }
    }
  } catch {
    // Don't fail the auth flow if our email send errors
  }

  return response
}

export const { GET } = handlers
