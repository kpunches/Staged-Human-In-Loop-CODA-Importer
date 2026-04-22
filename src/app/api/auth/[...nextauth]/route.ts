import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Resend from "next-auth/providers/resend"
import { prisma } from "@/lib/db"
import { sendMagicLinkEmail } from "@/lib/email"

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "wgu.edu"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
      // Override the default send function so we can use our branded template
      sendVerificationRequest: async ({ identifier: email, url }) => {
        await sendMagicLinkEmail({ to: email, magicLinkUrl: url })
      },
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify",
    error: "/auth/error",
  },
  callbacks: {
    // Block any email not ending in @wgu.edu before sending the magic link
    async signIn({ user }) {
      const email = user.email ?? ""
      if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false
      }
      return true
    },
    async session({ session, user }) {
      // Attach role and tenantId to the session so the UI can gate actions
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, tenantId: true, tenant: { select: { slug: true, name: true } } },
      })
      if (dbUser) {
        session.user.role = dbUser.role
        session.user.tenantId = dbUser.tenantId
        session.user.tenant = dbUser.tenant
      }
      return session
    },
  },
  events: {
    // Auto-provision a user record + default tenant on first sign-in
    async createUser({ user }) {
      // Find or create a default tenant based on email subdomain
      // In production you'd map email prefixes to specific tenants
      let tenant = await prisma.tenant.findFirst({
        where: { slug: "default" },
      })
      if (!tenant) {
        tenant = await prisma.tenant.create({
          data: { name: "WGU — Default", slug: "default" },
        })
      }
      await prisma.user.update({
        where: { id: user.id! },
        data: { tenantId: tenant.id, role: "ID" },
      })
    },
  },
})
