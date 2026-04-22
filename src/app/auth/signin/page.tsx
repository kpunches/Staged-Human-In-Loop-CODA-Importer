"use client"

import { useState } from "react"

export default function SignInPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    const domain = email.split("@")[1]?.toLowerCase()
    if (domain !== "wgu.edu") {
      setError("Only @wgu.edu email addresses are permitted.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/demo-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        window.location.href = "/dashboard"
      } else {
        const data = await res.json()
        setError(data.error ?? "Sign in failed. Please try again.")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "#f5f4f0", fontFamily: "'Helvetica Neue', Arial, sans-serif",
    }}>
      <div style={{
        width: "100%", maxWidth: "420px", background: "#fff",
        borderRadius: "16px", border: "1px solid #e0dfd8", overflow: "hidden",
      }}>
        <div style={{ background: "#002855", padding: "28px 36px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
            <div style={{
              width: "36px", height: "36px", borderRadius: "8px",
              background: "rgba(255,255,255,0.15)", display: "flex",
              alignItems: "center", justifyContent: "center",
              fontSize: "18px", fontWeight: "700", color: "#fff",
            }}>W</div>
            <span style={{ color: "#fff", fontSize: "17px", fontWeight: "600", letterSpacing: "-0.3px" }}>
              WGU Document Staging
            </span>
          </div>
          <p style={{ margin: 0, color: "rgba(255,255,255,0.65)", fontSize: "13px", lineHeight: "1.5" }}>
            Review and approve document imports before they write to Coda.
          </p>
        </div>

        <div style={{ padding: "36px" }}>
          <p style={{ margin: "0 0 24px", color: "#555", fontSize: "14px", lineHeight: "1.6" }}>
            Enter your WGU email address to sign in.
          </p>

          <form onSubmit={handleSubmit}>
            <label style={{ display: "block", marginBottom: "6px", fontSize: "13px", fontWeight: "500", color: "#333" }}>
              WGU email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="yourname@wgu.edu"
              required
              style={{
                width: "100%", padding: "10px 14px", borderRadius: "8px",
                border: "1px solid #d0cfc8", fontSize: "15px", color: "#1a1a1a",
                outline: "none", boxSizing: "border-box", marginBottom: "16px",
              }}
            />

            {error && (
              <div style={{
                padding: "10px 14px", borderRadius: "8px", background: "#fef2f2",
                border: "1px solid #fecaca", color: "#b91c1c", fontSize: "13px", marginBottom: "16px",
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              style={{
                width: "100%", padding: "12px", borderRadius: "8px",
                background: loading ? "#6b7280" : "#002855",
                color: "#fff", fontSize: "15px", fontWeight: "600",
                border: "none", cursor: loading ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p style={{ margin: "24px 0 0", color: "#aaa", fontSize: "12px", textAlign: "center" }}>
            Only @wgu.edu addresses may access this application.
          </p>
        </div>
      </div>
    </div>
  )
}
