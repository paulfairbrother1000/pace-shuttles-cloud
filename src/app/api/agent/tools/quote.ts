import type { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Validate minimal shape
    if (!body?.route_id || !body?.date_iso || !body?.seats) {
      return Response.json({ error: "Missing route_id/date_iso/seats" }, { status: 400 });
    }

    // Delegate to your SSOT
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL}/api/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store"
    });

    const data = await res.json();
    if (!res.ok) return Response.json({ error: data?.error || "Quote failed" }, { status: 502 });
    return Response.json(data);
  } catch (e: any) {
    return Response.json({ error: e?.message || "Bad request" }, { status: 400 });
  }
}
