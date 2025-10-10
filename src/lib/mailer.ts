// src/lib/mailer.ts
export type MailPayload = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: MailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY not set");
  const from = process.env.MAIL_FROM || "Pace Shuttles <no-reply@yourdomain>";
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  await resend.emails.send({ from, to, subject, html });
}
