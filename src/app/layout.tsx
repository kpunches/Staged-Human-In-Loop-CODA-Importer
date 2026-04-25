import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "WGU Import Staging",
  description: "Review and approve Coda data imports",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
