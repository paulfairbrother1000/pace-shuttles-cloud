// src/lib/mailer.ts
export type MailPayload = { to: string; subject: string; html: string };

export async function sendEmail({ to, subject, html }: MailPayload) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM || "Pace Shuttles hello@paceshuttles.com";
  if (!apiKey) throw new Error("RESEND_API_KEY not set");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend failed (${res.status}): ${text || res.statusText}`);
  }
}
