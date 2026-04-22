export { auth, signIn, signOut } from "@/lib/auth/config"

import "next-auth"
import type { UserRole } from "@prisma/client"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      role: UserRole
      tenantId: string
      tenant: {
        slug: string
        name: string
      }
    }
  }
}
