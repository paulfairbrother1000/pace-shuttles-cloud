import { NextResponse } from "next/server";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET() {
  try {
    const data = await resend.emails.send({
      from: "Pace Shuttles <hello@paceshuttles.com>",
      to: "paul.fairbrother@beyondservicemanagement.com",
      subject: "Test email from Pace Shuttles",
      html: `
        <div style="font-family:sans-serif;padding:20px;">
          <h2>🚀 It works!</h2>
          <p>Your site can now send formatted emails via Resend.</p>
          <p style="color:#555;">Sent from your live Vercel app.</p>
        </div>
      `,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message });
  }
}
