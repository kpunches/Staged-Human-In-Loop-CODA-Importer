export { auth, signIn, signOut } from "@/lib/auth/config"

import "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      role: "ID" | "EPD" | "AD" | "ADMIN"
      tenantId: string
      tenant: {
        slug: string
        name: string
      }
    }
  }
}
