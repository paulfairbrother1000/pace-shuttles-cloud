// src/app/api/email/on-paid/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendBookingPaidEmail } from "@/src/lib/email";

export async function POST(req: NextRequest) {
  try {
    const { order_id } = await req.json().catch(() => ({}));
    if (!order_id) {
      return NextResponse.json({ ok: false, error: "order_id required" }, { status: 400 });
    }

    const result = await sendBookingPaidEmail(order_id);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "send-failed" }, { status: 500 });
  }
}
