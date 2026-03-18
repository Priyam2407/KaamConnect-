const nodemailer = require("nodemailer");

// ─── Create transporter ──────────────────────────────────────
const createTransporter = () => {
  // Option 1: Custom SMTP (Brevo, Mailgun, Postmark, etc.)
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_PORT === "465",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     20000,
    });
  }

  // Option 2: Gmail via App Password
  // IMPORTANT: Gmail requires:
  //   1. 2-Step Verification ON at myaccount.google.com/security
  //   2. App Password created at myaccount.google.com/apppasswords
  //   3. Use the 16-char App Password (no spaces) as GMAIL_PASS
  return nodemailer.createTransport({
    host:    "smtp.gmail.com",
    port:    587,
    secure:  false,   // STARTTLS — works on Render/cloud
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
    tls: { rejectUnauthorized: false },
    connectionTimeout: 15000,
    greetingTimeout:   10000,
    socketTimeout:     20000,
  });
};

// ─── Send verification email ─────────────────────────────────
exports.sendVerificationEmail = async ({ name, email, token }) => {
  const user = process.env.GMAIL_USER || process.env.SMTP_USER;
  const pass = process.env.GMAIL_PASS || process.env.SMTP_PASS;

  console.log("[Mailer] ── Sending verification email ──");
  console.log("[Mailer] To:", email);
  console.log("[Mailer] SMTP user:", user ? "SET ✓" : "NOT SET ✗");
  console.log("[Mailer] SMTP pass:", pass ? pass.length + " chars ✓" : "NOT SET ✗");
  console.log("[Mailer] NODE_ENV:", process.env.NODE_ENV);

  if (!user || !pass) {
    throw new Error("GMAIL_USER or GMAIL_PASS not set in environment variables");
  }

  const transporter = createTransporter();

  const isProduction = process.env.NODE_ENV === "production";
  const baseUrl = isProduction
    ? (process.env.BASE_URL || "https://kaamconnect-im6s.onrender.com")
    : (process.env.APP_URL  || process.env.BASE_URL || "https://kaamconnect-im6s.onrender.com");

  const link = `${baseUrl}/api/auth/verify-email?token=${token}`;
  console.log("[Mailer] Verify link:", link);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify your KaamConnect email</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;padding:40px 20px">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(15,25,35,.08)">
      <tr><td style="background:linear-gradient(135deg,#1A3C34,#24524A);padding:36px 40px;text-align:center">
        <div style="width:40px;height:40px;background:#E8601C;border-radius:10px;display:inline-block;line-height:40px;text-align:center;font-size:20px;vertical-align:middle">🔧</div>
        <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;margin-left:10px;vertical-align:middle">Kaam<span style="color:#F0783A">Connect</span></span>
        <p style="color:rgba(255,255,255,.55);font-size:13px;margin:12px 0 0">India's Trusted Worker Marketplace 🇮🇳</p>
      </td></tr>
      <tr><td style="padding:40px 40px 32px">
        <h1 style="font-family:Georgia,serif;font-size:26px;font-weight:700;color:#1A3C34;margin:0 0 8px">Verify your email address</h1>
        <p style="font-size:15px;color:rgba(15,25,35,.6);margin:0 0 28px;line-height:1.6">Hi <strong style="color:#1A3C34">${name}</strong> 👋 — click the button below to activate your KaamConnect account.</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td align="center" style="padding:0 0 28px">
            <a href="${link}" style="display:inline-block;padding:15px 40px;background:#E8601C;color:#ffffff;text-decoration:none;border-radius:11px;font-size:15px;font-weight:700">✅  Verify My Email</a>
          </td></tr>
        </table>
        <div style="background:#FEF0E8;border:1.5px solid #FDE0CF;border-radius:10px;padding:14px 18px;margin-bottom:24px">
          <p style="font-size:13px;color:#E8601C;margin:0;font-weight:600">⏰ This link expires in <strong>24 hours</strong></p>
        </div>
        <p style="font-size:12.5px;color:rgba(15,25,35,.4);margin:0 0 6px">If the button doesn't work, copy this link into your browser:</p>
        <p style="font-size:12px;word-break:break-all;color:#3D7A6E;margin:0">${link}</p>
      </td></tr>
      <tr><td style="background:#F8F8F6;border-top:1px solid rgba(15,25,35,.06);padding:22px 40px;text-align:center">
        <p style="font-size:12px;color:rgba(15,25,35,.3);margin:0">If you didn't create a KaamConnect account, ignore this email.</p>
        <p style="font-size:12px;color:rgba(15,25,35,.3);margin:8px 0 0">© 2026 KaamConnect — India's Trusted Worker Marketplace</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // 20 second hard timeout
  const info = await Promise.race([
    transporter.sendMail({
      from:    `"KaamConnect" <${user}>`,
      to:      email,
      subject: "Verify your KaamConnect email address",
      html,
      text: `Hi ${name},\n\nVerify your KaamConnect account:\n${link}\n\nThis link expires in 24 hours.\n\n— KaamConnect Team`,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        "SMTP timeout after 20s. Likely cause: wrong GMAIL_PASS (needs App Password, not Gmail login password). " +
        "Go to myaccount.google.com/apppasswords to generate one."
      )), 20000)
    ),
  ]);

  console.log("[Mailer] ✅ Sent! messageId:", info.messageId);
  return info;
};