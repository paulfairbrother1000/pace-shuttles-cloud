import { NextResponse } from "next/server";
export const runtime = "nodejs";

export async function GET() {
  try {
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
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(data));
    return NextResponse.json({ ok: true, data });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
