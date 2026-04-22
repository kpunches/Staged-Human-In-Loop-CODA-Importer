export { auth, signIn, signOut } from "@/app/api/auth/[...nextauth]/route"

// Augment the next-auth Session type so TypeScript knows about our custom fields
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
