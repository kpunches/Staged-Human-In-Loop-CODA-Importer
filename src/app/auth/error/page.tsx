"use client"
import { useSearchParams } from "next/navigation"
import { Suspense } from "react"

const ERROR_MESSAGES: Record<string, string> = {
  Signin: "Unable to sign in. Please try again.",
  OAuthSignin: "Unable to initiate sign in.",
  OAuthCallback: "Unable to complete sign in.",
  OAuthCreateAccount: "Unable to create account.",
  EmailCreateAccount: "Unable to create account with this email.",
  Callback: "An error occurred during sign in.",
  OAuthAccountNotLinked: "This email is linked to a different sign-in method.",
  EmailSignin: "Unable to send sign-in email. Please try again.",
  CredentialsSignin: "Invalid credentials.",
  SessionRequired: "Please sign in to access this page.",
  AccessDenied: "Access denied. Only @wgu.edu email addresses are permitted.",
  Default: "An unexpected error occurred.",
}

function ErrorContent() {
  const params = useSearchParams()
  const error = params.get("error") ?? "Default"
  const message = ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default

  return (
    <div style={{ padding: "40px 36px", textAlign: "center" }}>
      <div style={{
        width: "56px", height: "56px", borderRadius: "12px",
        background: "#fef2f2", margin: "0 auto 20px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b91c1c" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <h1 style={{ margin: "0 0 12px", fontSize: "20px", fontWeight: "600", color: "#1a1a1a" }}>
        Sign-in failed
      </h1>
      <p style={{ margin: "0 0 32px", color: "#555", fontSize: "15px", lineHeight: "1.6" }}>
        {message}
      </p>
      <a href="/auth/signin" style={{
        display: "inline-block",
        padding: "12px 28px",
        borderRadius: "8px",
        background: "#002855",
        color: "#fff",
        fontSize: "14px",
        fontWeight: "600",
        textDecoration: "none",
      }}>
        Try again
      </a>
    </div>
  )
}

export default function AuthErrorPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#f5f4f0",
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
    }}>
      <div style={{
        width: "100%",
        maxWidth: "420px",
        background: "#fff",
        borderRadius: "16px",
        border: "1px solid #e0dfd8",
        overflow: "hidden",
      }}>
        <div style={{ background: "#002855", padding: "28px 36px" }}>
          <span style={{ color: "#fff", fontSize: "17px", fontWeight: "600" }}>
            WGU Document Staging
          </span>
        </div>
        <Suspense fallback={<div style={{ padding: "40px", textAlign: "center", color: "#888" }}>Loading…</div>}>
          <ErrorContent />
        </Suspense>
      </div>
    </div>
  )
}
