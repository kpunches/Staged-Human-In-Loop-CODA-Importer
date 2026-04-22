export default function VerifyPage() {
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
        <div style={{ padding: "40px 36px", textAlign: "center" }}>
          {/* Envelope icon */}
          <div style={{
            width: "56px", height: "56px", borderRadius: "12px",
            background: "#eff6ff", margin: "0 auto 20px",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#002855" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <path d="M2 7l10 7 10-7"/>
            </svg>
          </div>
          <h1 style={{ margin: "0 0 12px", fontSize: "20px", fontWeight: "600", color: "#1a1a1a", letterSpacing: "-0.4px" }}>
            Check your email
          </h1>
          <p style={{ margin: "0 0 8px", color: "#555", fontSize: "15px", lineHeight: "1.6" }}>
            A sign-in link has been sent to your WGU email address.
          </p>
          <p style={{ margin: "0 0 32px", color: "#888", fontSize: "13px", lineHeight: "1.6" }}>
            The link expires in 10 minutes. Check your spam folder if it doesn't arrive within a minute.
          </p>
          <a href="/auth/signin" style={{
            display: "inline-block",
            padding: "10px 24px",
            borderRadius: "8px",
            border: "1px solid #d0cfc8",
            color: "#555",
            fontSize: "14px",
            textDecoration: "none",
          }}>
            Back to sign in
          </a>
        </div>
      </div>
    </div>
  )
}
