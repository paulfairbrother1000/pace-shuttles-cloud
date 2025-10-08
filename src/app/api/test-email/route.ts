import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  try {
<<<<<<< HEAD
    const data = await resend.emails.send({
      from: "Pace Shuttles <hello@paceshuttles.com>",
      to: "paul.fairbrother@beyondservicemanagement.com",
      subject: "Test email from Pace Shuttles - Welcome & Congrats!!",
      html: `
        <div style="font-family:sans-serif;padding:20px;">
          <h2>🚀 It works!</h2>
          <p>Your site can now send formatted emails via Resend.</p>
          <p style="color:#555;">Sent from your live Vercel app.</p>
        </div>
      `,
=======
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Pace Shuttles <info@paceshuttles.com>",
        to: ["paul@paceshuttles.com"],
        subject: "Test email from Pace Shuttles",
        html: "<h2>It works (no SDK)!</h2>",
      }),
>>>>>>> 61f9e81b625bd0ebb22543696db20334f3efc039
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
