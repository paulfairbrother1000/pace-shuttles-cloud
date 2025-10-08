// src/app/api/test-email/route.ts
import { NextResponse } from "next/server";
import { Resend } from "resend";

export const runtime = "nodejs";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const to = url.searchParams.get("to") ?? "paul.fairbrother@beyondservicemanagement.com";

    const data = await resend.emails.send({
      from: "Pace Shuttles <hello@paceshuttles.com>", // must be on your verified domain
      to,
      subject: "Test email from Pace Shuttles",
      html: `
        <div style="font-family:sans-serif;padding:20px;">
          <h2>🚀 It works!</h2>
          <p>Your site can now send formatted emails via Resend.</p>
          <p style="color:#555;">Sent from your live Vercel app.</p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
