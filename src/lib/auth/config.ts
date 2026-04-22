import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import Resend from "next-auth/providers/resend"
import { prisma } from "@/lib/db"

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "wgu.edu"

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  adapter: PrismaAdapter(prisma),
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev",
      // sendVerificationRequest is intentionally omitted here.
      // We override it at the API route level to avoid nodemailer
      // being bundled into the Edge Runtime via middleware.
    }),
  ],
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify",
    error: "/auth/error",
  },
  callbacks: {
    async signIn({ user }) {
      const email = user.email ?? ""
      if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
        return false
      }
      return true
    },
    async session({ session, user }) {
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { role: true, tenantId: true, tenant: { select: { slug: true, name: true } } },
      })
      if (dbUser?.tenant) {
        session.user.role = dbUser.role
        session.user.tenantId = dbUser.tenantId
        session.user.tenant = dbUser.tenant
      } else {
        session.user.role = "ID"
        session.user.tenantId = ""
        session.user.tenant = { slug: "default", name: "WGU" }
      }
      return session
    },
  },
  events: {
    async createUser({ user }) {
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
