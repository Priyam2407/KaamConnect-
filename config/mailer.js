const nodemailer = require("nodemailer");

// ─── Create & verify transporter ─────────────────────────────
const createTransporter = () => {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  // Gmail — requires App Password (not your regular password)
  // Enable at: myaccount.google.com/apppasswords
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,                          // SSL on port 465 — most reliable
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,        // 16-char App Password (no spaces)
    },
    tls: { rejectUnauthorized: false },    // prevents self-signed cert errors
  });
};

// ─── Send verification email ─────────────────────────────────
exports.sendVerificationEmail = async ({ name, email, token }) => {
  const transporter = createTransporter();

  // ── Verify connection before sending ──────────────────────
  console.log("[Mailer] Verifying SMTP connection…");
  console.log("[Mailer] GMAIL_USER:", process.env.GMAIL_USER ? "SET ✓" : "NOT SET ✗");
  console.log("[Mailer] GMAIL_PASS:", process.env.GMAIL_PASS ? "SET ✓" : "NOT SET ✗");

  await transporter.verify().catch(err => {
    console.error("[Mailer] SMTP connection FAILED:", err.message);
    throw new Error("SMTP connection failed: " + err.message);
  });
  console.log("[Mailer] SMTP connection OK ✓");

  const baseUrl = process.env.APP_URL || process.env.BASE_URL || "http://localhost:5000";
  const link = `${baseUrl}/api/auth/verify-email?token=${token}`;

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify your KaamConnect email</title>
</head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;padding:40px 20px">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(15,25,35,.08)">

      <!-- Header -->
      <tr><td style="background:linear-gradient(135deg,#1A3C34,#24524A);padding:36px 40px;text-align:center">
        <table cellpadding="0" cellspacing="0" style="margin:0 auto">
          <tr>
            <td style="padding:0 10px">
              <div style="width:36px;height:36px;background:#E8601C;border-radius:10px;display:inline-block;line-height:36px;text-align:center;font-size:18px;vertical-align:middle">🔧</div>
            </td>
            <td>
              <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px">Kaam<span style="color:#F0783A">Connect</span></span>
            </td>
          </tr>
        </table>
        <p style="color:rgba(255,255,255,.55);font-size:13px;margin:12px 0 0">India's Trusted Worker Marketplace 🇮🇳</p>
      </td></tr>

      <!-- Body -->
      <tr><td style="padding:40px 40px 32px">
        <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#1A3C34;margin:0 0 8px;letter-spacing:-0.5px">Verify your email address</h1>
        <p style="font-size:15px;color:rgba(15,25,35,.6);margin:0 0 28px;line-height:1.6">Hi <strong style="color:#1A3C34">${name}</strong> 👋 — you're almost ready to use KaamConnect. Click the button below to verify your email address and activate your account.</p>

        <!-- CTA Button -->
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td align="center" style="padding:0 0 28px">
            <a href="${link}" style="display:inline-block;padding:15px 40px;background:#E8601C;color:#ffffff;text-decoration:none;border-radius:11px;font-size:15px;font-weight:700;letter-spacing:0.2px">✅  Verify My Email</a>
          </td></tr>
        </table>

        <!-- Expiry note -->
        <div style="background:#FEF0E8;border:1.5px solid #FDE0CF;border-radius:10px;padding:14px 18px;margin-bottom:24px">
          <p style="font-size:13px;color:#E8601C;margin:0;font-weight:600">⏰ This link expires in <strong>24 hours</strong></p>
        </div>

        <p style="font-size:12.5px;color:rgba(15,25,35,.4);margin:0 0 6px">If the button doesn't work, paste this link in your browser:</p>
        <p style="font-size:12px;word-break:break-all;color:#3D7A6E;margin:0">${link}</p>
      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#F8F8F6;border-top:1px solid rgba(15,25,35,.06);padding:22px 40px;text-align:center">
        <p style="font-size:12px;color:rgba(15,25,35,.3);margin:0">If you didn't create a KaamConnect account, you can safely ignore this email.</p>
        <p style="font-size:12px;color:rgba(15,25,35,.3);margin:8px 0 0">© 2026 KaamConnect — India's Trusted Worker Marketplace</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

  const info = await transporter.sendMail({
    from:    `"KaamConnect" <${process.env.GMAIL_USER || process.env.SMTP_USER}>`,
    to:      email,
    subject: "Verify your KaamConnect email address",
    html,
    text: `Hi ${name},\n\nVerify your KaamConnect email:\n${link}\n\nThis link expires in 24 hours.\n\n— KaamConnect Team`,
  });

  console.log("[Mailer] Email sent ✓ messageId:", info.messageId, "→", email);
  return info;
};