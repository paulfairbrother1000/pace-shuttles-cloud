// src/lib/email/mailer.ts
import { Resend } from "resend";

const RESEND_KEY = process.env.RESEND_API_KEY || "";

const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null;

export async function sendMail(opts: {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  from?: string; // optional override
}) {
  const from = opts.from || "Pace Shuttles <hello@paceshuttles.com>";
  if (!resend) {
    console.warn("[mailer] RESEND_API_KEY not set — email would be sent:", {
      ...opts,
      from,
    });
    return { ok: true, mocked: true };
  }
  const r = await resend.emails.send({
    from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
  if (r.error) throw new Error(r.error.message || "send error");
  return { ok: true, id: (r.data as any)?.id };
}
