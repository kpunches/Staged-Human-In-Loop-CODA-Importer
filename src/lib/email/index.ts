import { createTransport } from "nodemailer"

interface MagicLinkEmailParams {
  to: string
  magicLinkUrl: string
}

function getTransport() {
  // Gmail SMTP if configured, fallback to Resend SMTP
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
    return createTransport({
      service: "gmail",
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
      },
    })
  }
  // Resend SMTP fallback
  return createTransport({
    host: "smtp.resend.com",
    port: 465,
    secure: true,
    auth: {
      user: "resend",
      pass: process.env.RESEND_API_KEY,
    },
  })
}

export async function sendMagicLinkEmail({ to, magicLinkUrl }: MagicLinkEmailParams) {
  const transport = getTransport()
  const from = process.env.GMAIL_USER
    ? `WGU Document Staging <${process.env.GMAIL_USER}>`
    : process.env.RESEND_FROM_EMAIL!

  await transport.sendMail({
    from,
    to,
    subject: "Sign in to WGU Document Staging",
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f5f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4f0;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e0dfd8;">
          <tr>
            <td style="background:#002855;padding:28px 40px;">
              <p style="margin:0;color:#ffffff;font-size:18px;font-weight:600;letter-spacing:-0.3px;">
                WGU Document Staging
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 16px;color:#1a1a1a;font-size:16px;line-height:1.6;">
                Click the button below to sign in. This link expires in <strong>10 minutes</strong> and can only be used once.
              </p>
              <p style="margin:0 0 32px;color:#555;font-size:14px;line-height:1.6;">
                If you didn't request this, you can safely ignore this email.
              </p>
              <table cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background:#002855;border-radius:8px;">
                    <a href="${magicLinkUrl}"
                       style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.2px;">
                      Sign in to Staging App
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:32px 0 0;color:#888;font-size:12px;line-height:1.6;">
                Or copy and paste this URL into your browser:<br/>
                <a href="${magicLinkUrl}" style="color:#002855;word-break:break-all;">${magicLinkUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #e0dfd8;">
              <p style="margin:0;color:#aaa;font-size:12px;">
                Western Governors University · Salt Lake City, UT 84107<br/>
                Only @wgu.edu addresses may sign in to this application.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`,
  })
}
