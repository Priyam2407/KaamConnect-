const nodemailer = require("nodemailer");

// ─────────────────────────────────────────────────────────────
//  Transporter — uses Brevo (SMTP_HOST set) or Gmail fallback
// ─────────────────────────────────────────────────────────────
const createTransporter = () => {
  if (process.env.SMTP_HOST) {
    // Brevo / any custom SMTP
    return nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 15000,
      greetingTimeout:   10000,
      socketTimeout:     20000,
    });
  }
  // Gmail fallback (works on localhost only)
  return nodemailer.createTransport({
    host:   "smtp.gmail.com",
    port:   587,
    secure: false,
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

// ─────────────────────────────────────────────────────────────
//  Send verification email
// ─────────────────────────────────────────────────────────────
exports.sendVerificationEmail = async ({ name, email, token }) => {

  // ── Detect which provider is active ──────────────────────
  const usingBrevo = !!process.env.SMTP_HOST;

  // The login credential for SMTP auth
  const smtpUser = usingBrevo ? process.env.SMTP_USER : process.env.GMAIL_USER;
  const smtpPass = usingBrevo ? process.env.SMTP_PASS : process.env.GMAIL_PASS;

  // The FROM address shown to recipients
  // For Brevo: use MAIL_FROM env var (your verified sender email)
  //            or fall back to GMAIL_USER
  // For Gmail: use GMAIL_USER
  const fromAddress = process.env.MAIL_FROM
    || process.env.GMAIL_USER
    || smtpUser;

  // ── Debug logs (visible in Render logs) ──────────────────
  console.log("[Mailer] ── Sending email ──────────────────");
  console.log("[Mailer] Provider :", usingBrevo ? "Brevo (SMTP)" : "Gmail");
  console.log("[Mailer] SMTP host:", process.env.SMTP_HOST || "smtp.gmail.com");
  console.log("[Mailer] SMTP user:", smtpUser || "NOT SET ✗");
  console.log("[Mailer] SMTP pass:", smtpPass ? smtpPass.length + " chars ✓" : "NOT SET ✗");
  console.log("[Mailer] From     :", fromAddress || "NOT SET ✗");
  console.log("[Mailer] To       :", email);
  console.log("[Mailer] NODE_ENV :", process.env.NODE_ENV);

  // ── Guard — fail fast with clear message ────────────────
  if (!smtpUser || !smtpPass) {
    throw new Error(
      usingBrevo
        ? "SMTP_USER or SMTP_PASS not set. Add them in Render → Environment."
        : "GMAIL_USER or GMAIL_PASS not set. Add them in your .env file."
    );
  }

  // ── Verification link ────────────────────────────────────
  const isProduction = process.env.NODE_ENV === "production";
  const baseUrl = isProduction
    ? (process.env.BASE_URL || "https://kaamconnect-im6s.onrender.com")
    : (process.env.APP_URL  || process.env.BASE_URL || "http://localhost:5000");
  const link = `${baseUrl}/api/auth/verify-email?token=${token}`;
  console.log("[Mailer] Link     :", link);

  // ── Email HTML ───────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify your KaamConnect email</title></head>
<body style="margin:0;padding:0;background:#FAF7F2;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F2;padding:40px 20px">
  <tr><td align="center">
    <table width="100%" style="max-width:560px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(15,25,35,.08)">
      <tr><td style="background:linear-gradient(135deg,#1A3C34,#24524A);padding:36px 40px;text-align:center">
        <div style="width:40px;height:40px;background:#E8601C;border-radius:10px;display:inline-block;line-height:40px;text-align:center;font-size:20px;vertical-align:middle">🔧</div>
        <span style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#fff;margin-left:10px;vertical-align:middle">Kaam<span style="color:#F0783A">Connect</span></span>
        <p style="color:rgba(255,255,255,.55);font-size:13px;margin:10px 0 0">India's Trusted Worker Marketplace 🇮🇳</p>
      </td></tr>
      <tr><td style="padding:40px">
        <h1 style="font-size:24px;font-weight:700;color:#1A3C34;margin:0 0 12px">Verify your email address</h1>
        <p style="font-size:15px;color:rgba(15,25,35,.6);margin:0 0 28px;line-height:1.6">Hi <strong style="color:#1A3C34">${name}</strong> 👋 — click the button below to activate your KaamConnect account.</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          <tr><td align="center" style="padding:0 0 28px">
            <a href="${link}" style="display:inline-block;padding:14px 40px;background:#E8601C;color:#fff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700">✅ Verify My Email</a>
          </td></tr>
        </table>
        <div style="background:#FEF0E8;border:1.5px solid #FDE0CF;border-radius:10px;padding:14px 18px;margin-bottom:24px">
          <p style="font-size:13px;color:#E8601C;margin:0;font-weight:600">⏰ This link expires in 24 hours</p>
        </div>
        <p style="font-size:12px;color:rgba(15,25,35,.4);margin:0 0 6px">If the button does not work, copy this link into your browser:</p>
        <p style="font-size:12px;word-break:break-all;color:#3D7A6E;margin:0">${link}</p>
      </td></tr>
      <tr><td style="background:#F8F8F6;border-top:1px solid rgba(15,25,35,.06);padding:20px 40px;text-align:center">
        <p style="font-size:12px;color:rgba(15,25,35,.3);margin:0">If you did not create a KaamConnect account, ignore this email.</p>
        <p style="font-size:12px;color:rgba(15,25,35,.3);margin:6px 0 0">© 2026 KaamConnect</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  // ── Send with 20s timeout ────────────────────────────────
  const transporter = createTransporter();
  const info = await Promise.race([
    transporter.sendMail({
      from:    `"KaamConnect" <${fromAddress}>`,
      to:      email,
      subject: "Verify your KaamConnect email address",
      html,
      text: `Hi ${name},\n\nVerify your KaamConnect account:\n${link}\n\nThis link expires in 24 hours.\n\n— KaamConnect Team`,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(
        "SMTP timeout (20s). Check SMTP credentials in Render environment variables."
      )), 20000)
    ),
  ]);

  console.log("[Mailer] ✅ Email sent! messageId:", info.messageId);
  return info;
};