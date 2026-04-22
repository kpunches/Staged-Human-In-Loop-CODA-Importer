import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Middleware is intentionally minimal — auth is checked at the page/route level.
// NextAuth v5 session tokens are JWTs that can't be verified in Edge Runtime
// without the full auth config, so we skip middleware-level auth entirely.
export function middleware(req: NextRequest) {
  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
