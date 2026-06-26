import nodemailer from "nodemailer";

/**
 * Reusable Nodemailer transport. Lazily created so the app boots even
 * when SMTP env vars are missing.
 *
 * Required env:
 *   MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS, MAIL_FROM
 */
let cachedTransport = null;

export function getTransport() {
  if (cachedTransport) return cachedTransport;

  const host = process.env.MAIL_HOST;
  const port = Number(process.env.MAIL_PORT ?? 587);
  const user = process.env.MAIL_USER;
  const pass = process.env.MAIL_PASS;

  if (!host || !user || !pass) {
    throw new Error(
      "SMTP transport not configured. Set MAIL_HOST, MAIL_USER, MAIL_PASS in .env.local."
    );
  }

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465 (TLS), false for 587 (STARTTLS)
    auth: { user, pass },
  });
  return cachedTransport;
}

/**
 * Send a transactional email.
 *
 * @param {{ to: string, subject: string, html?: string, text?: string }} opts
 */
export async function sendEmail({ to, subject, html, text }) {
  const transport = getTransport();
  const from = process.env.MAIL_FROM;
  if (!from) throw new Error("MAIL_FROM is not set.");

  const info = await transport.sendMail({ from, to, subject, html, text });
  return info;
}