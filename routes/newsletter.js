import express from "express";
import { body, validationResult } from "express-validator";
import { Resend } from "resend";
import pool from "../config/db.js";
import authMiddleware from "../middleware/auth.js";
import cloudinary from "../config/cloudinary.js";

const router = express.Router();

// ── Auto-create sends history table ──────────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS newsletter_sends (
    id              SERIAL PRIMARY KEY,
    subject         TEXT NOT NULL,
    image_url       TEXT,
    intro_text      TEXT,
    recipient_count INTEGER DEFAULT 0,
    is_test         BOOLEAN DEFAULT false,
    sent_at         TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(console.error);

// ── Auto-create cookie consent log table ──────────────────────────────────────
pool.query(`
  CREATE TABLE IF NOT EXISTS cookie_consents (
    id          SERIAL PRIMARY KEY,
    ip_address  TEXT,
    user_agent  TEXT,
    accepted_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(console.error);

// ── Resend client (lazy init so a missing key doesn't crash the server) ───────
let _resend = null;
const getResend = () => {
  if (!_resend) {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
};

// ── HTML email template ───────────────────────────────────────────────────────
const buildEmailHtml = ({ subject, introText, imageUrl, recipientEmail }) => {
  const unsubUrl = `https://cry808.com/api/newsletter/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1.0" />
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#000;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#000;">

          <!-- Header -->
          <tr>
            <td style="padding:20px 32px 20px;border-bottom:1px solid #1a1a1a;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <span style="color:#fff;font-size:22px;font-weight:900;letter-spacing:0.22em;text-transform:uppercase;">CRY808</span>
                    <span style="display:block;color:#555;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;margin-top:2px;">Hip-Hop News &amp; Culture</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${introText ? `
          <!-- Intro -->
          <tr>
            <td style="padding:28px 32px 0;color:#bbb;font-size:15px;line-height:1.7;">
              ${introText.replace(/\n/g, "<br/>")}
            </td>
          </tr>` : ""}

          <!-- Magazine cover -->
          <tr>
            <td style="padding:${introText ? "24px" : "0"} 0 0;">
              <img
                src="${imageUrl}"
                alt="${subject}"
                style="width:100%;max-width:600px;display:block;border:0;"
              />
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:36px 32px;">
              <a
                href="https://cry808.com"
                style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#7c3aed,#ec4899);color:#fff;text-decoration:none;font-weight:700;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;"
              >
                Read More on Cry808 →
              </a>
            </td>
          </tr>

          <!-- Divider -->
          <tr><td style="border-top:1px solid #1a1a1a;"></td></tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;text-align:center;">
              <p style="margin:0 0 10px;color:#777;font-size:11px;line-height:1.6;">
                You're receiving this because you subscribed at cry808.com.
              </p>
              <a
                href="${unsubUrl}"
                style="color:#888;font-size:11px;text-decoration:underline;"
              >
                Unsubscribe
              </a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// ── Plain-text fallback (required for good deliverability) ────────────────────
const buildEmailText = ({ subject, introText, imageUrl, recipientEmail }) => {
  const unsubUrl = `https://cry808.com/api/newsletter/unsubscribe?email=${encodeURIComponent(recipientEmail)}`;
  return [
    'CRY808 — Hip-Hop News & Culture',
    '================================',
    '',
    subject,
    '',
    introText ? introText + '\n' : '',
    'View the full issue online:',
    imageUrl,
    '',
    '--------------------------------',
    'Read more: https://cry808.com',
    '',
    "You're receiving this because you subscribed at cry808.com.",
    `Unsubscribe: ${unsubUrl}`,
  ].join('\n');
};

// ── GET /api/newsletter/upload-params  — admin, returns Cloudinary signing params ──
// The browser uses these to upload the image DIRECTLY to Cloudinary, bypassing
// the server entirely (no body-size limit, no Vercel timeout, no CORS on upload).
router.get("/upload-params", authMiddleware, (req, res) => {
  try {
    const timestamp = Math.round(Date.now() / 1000);
    const folder    = "newsletter_covers";
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder },
      process.env.CLOUDINARY_API_SECRET
    );
    res.json({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key:    process.env.CLOUDINARY_API_KEY,
      timestamp,
      folder,
      signature,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/newsletter/send  — admin, send newsletter ──────────────────────
// Body: { subject, image_url, intro_text?, is_test }
router.post("/send", authMiddleware, async (req, res) => {
  const { subject, image_url, intro_text, is_test } = req.body;
  if (!subject?.trim()) return res.status(400).json({ message: "Subject is required" });
  if (!image_url?.trim()) return res.status(400).json({ message: "Cover image is required" });

  const TEST_EMAIL = process.env.TEST_EMAIL || "tamerbots@gmail.com";

  try {
    // Determine recipients
    let recipients = [];
    if (is_test) {
      recipients = [{ email: TEST_EMAIL }];
    } else {
      const { rows } = await pool.query(
        "SELECT email FROM newsletter_subscribers WHERE is_active = true ORDER BY subscribed_at ASC"
      );
      recipients = rows;
    }

    if (!recipients.length) {
      return res.status(400).json({ message: "No active subscribers to send to" });
    }

    const fromAddress = process.env.RESEND_FROM_EMAIL || "newsletter@cry808.com";
    const fromName = `Cry808 Newsletter <${fromAddress}>`;

    let sent = 0;
    const errors = [];

    for (const { email } of recipients) {
      try {
        const unsubUrl = `https://cry808.com/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}`;
        const unsubMailto = `mailto:${fromAddress}?subject=Unsubscribe%20${encodeURIComponent(email)}`;

        const { error: sendError } = await getResend().emails.send({
          from: fromName,
          to: email,
          subject,
          text: buildEmailText({
            subject,
            introText: intro_text?.trim() || "",
            imageUrl: image_url,
            recipientEmail: email,
          }),
          html: buildEmailHtml({
            subject,
            introText: intro_text?.trim() || "",
            imageUrl: image_url,
            recipientEmail: email,
          }),
          headers: {
            "List-Unsubscribe": `<${unsubUrl}>, <${unsubMailto}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            "Precedence": "bulk",
            "X-Auto-Response-Suppress": "OOF, AutoReply",
          },
        });

        if (sendError) throw new Error(sendError.message);
        sent++;
        // Small delay between sends
        if (recipients.length > 1) await new Promise(r => setTimeout(r, 100));
      } catch (e) {
        errors.push({ email, error: e.message });
        console.error(`Failed to send to ${email}:`, e.message);
      }
    }

    // Log to history
    await pool.query(
      `INSERT INTO newsletter_sends (subject, image_url, intro_text, recipient_count, is_test)
       VALUES ($1, $2, $3, $4, $5)`,
      [subject, image_url, intro_text || null, sent, !!is_test]
    );

    res.json({
      sent,
      total: recipients.length,
      errors,
      message: is_test
        ? `Test email sent to ${TEST_EMAIL}`
        : `Sent to ${sent} of ${recipients.length} subscribers`,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── GET /api/newsletter/sends  — admin, send history ─────────────────────────
router.get("/sends", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT * FROM newsletter_sends ORDER BY sent_at DESC LIMIT 50"
    );
    res.json({ sends: rows });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ── POST /api/newsletter/subscribe ───────────────────────────────────────────
router.post(
  "/subscribe",
  [body("email").trim().isEmail().withMessage("Please provide a valid email address").normalizeEmail()],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email } = req.body;
    try {
      const existing = await pool.query(
        "SELECT * FROM newsletter_subscribers WHERE email = $1", [email]
      );
      if (existing.rows.length > 0) {
        if (!existing.rows[0].is_active) {
          await pool.query(
            "UPDATE newsletter_subscribers SET is_active = true, subscribed_at = CURRENT_TIMESTAMP WHERE email = $1",
            [email]
          );
          return res.status(200).json({ message: "Welcome back! Your subscription has been reactivated." });
        }
        return res.status(400).json({ message: "This email is already subscribed to our newsletter." });
      }

      const result = await pool.query(
        `INSERT INTO newsletter_subscribers (email) VALUES ($1)
         RETURNING id, email, subscribed_at, is_active`,
        [email]
      );
      res.status(201).json({
        message: "Successfully subscribed to the newsletter!",
        subscriber: { email: result.rows[0].email, subscribed_at: result.rows[0].subscribed_at },
      });
    } catch (e) {
      res.status(500).json({ message: "Server error. Please try again later." });
    }
  }
);

// ── GET /api/newsletter/subscribers  — admin ──────────────────────────────────
router.get("/subscribers", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, email, subscribed_at, is_active FROM newsletter_subscribers ORDER BY subscribed_at DESC"
    );
    res.json({
      subscribers: result.rows,
      count: result.rows.length,
      active_count: result.rows.filter(s => s.is_active).length,
    });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/newsletter/unsubscribe  — public, via email link click ───────────
router.get("/unsubscribe", async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ message: "Email required" });
  try {
    await pool.query(
      "UPDATE newsletter_subscribers SET is_active = false WHERE email = $1", [email]
    );
    res.redirect(`https://cry808.com/unsubscribe?email=${encodeURIComponent(email)}&done=1`);
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/newsletter/unsubscribe  — RFC 8058 one-click (Gmail uses this) ──
router.post("/unsubscribe", async (req, res) => {
  // Gmail sends: List-Unsubscribe=One-Click in the POST body
  const email = req.query.email || req.body?.email;
  if (!email) return res.status(400).json({ message: "Email required" });
  try {
    await pool.query(
      "UPDATE newsletter_subscribers SET is_active = false WHERE email = $1", [email]
    );
    res.status(200).json({ message: "Unsubscribed" });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /api/newsletter/cookie-consent  — public, log acceptance ────────────
router.post("/cookie-consent", async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    await pool.query(
      "INSERT INTO cookie_consents (ip_address, user_agent) VALUES ($1, $2)",
      [ip, ua]
    );
    res.status(201).json({ message: "Consent logged" });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── GET /api/newsletter/cookie-consents  — admin ──────────────────────────────
router.get("/cookie-consents", authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, ip_address, user_agent, accepted_at FROM cookie_consents ORDER BY accepted_at DESC LIMIT 500"
    );
    res.json({ consents: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── DELETE /api/newsletter/unsubscribe/:email  — public ───────────────────────
router.delete("/unsubscribe/:email", async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE newsletter_subscribers SET is_active = false WHERE email = $1 RETURNING *",
      [req.params.email]
    );
    if (!result.rows.length) return res.status(404).json({ message: "Email not found." });
    res.json({ message: "Successfully unsubscribed from the newsletter." });
  } catch (e) {
    res.status(500).json({ message: "Server error" });
  }
});

export default router;
