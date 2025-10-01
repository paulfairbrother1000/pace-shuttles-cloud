import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const orderId = url.searchParams.get("orderId") || url.searchParams.get("id") || "";
  const s = url.searchParams.get("s") || url.searchParams.get("token") || "";
  if (!orderId || !s) {
    return new NextResponse("Missing order params", { status: 400 });
  }

  const jar = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => jar.set(name, value, options),
        remove: (name, options) => jar.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );

  const { data: order } = await sb
    .from("orders")
    .select("id, qty, journey_date, unit_price_cents, base_cents, tax_cents, fees_cents, total_cents, success_token")
    .eq("id", orderId)
    .maybeSingle();

  if (!order || order.success_token !== s) {
    return new NextResponse("Order not found or token mismatch", { status: 404 });
  }

  const £ = (cents?: number | null) =>
    cents == null
      ? "—"
      : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
          cents / 100
        );

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Pace Shuttles – Receipt</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Arial, "Apple Color Emoji","Segoe UI Emoji"; margin: 32px; }
      .row { display:flex; justify-content: space-between; margin: 6px 0; }
      .total { font-weight: 700; font-size: 18px; margin-top: 8px; }
      hr { border: none; border-top: 1px solid #e5e7eb; margin: 12px 0; }
    </style>
  </head>
  <body onload="window.print()">
    <h1>Pace Shuttles – Payment receipt</h1>
    <div>Order ID: <code>${order.id}</code></div>
    <div>Travel date: ${order.journey_date ?? "—"}</div>
    <hr/>
    <div class="row"><div>Seats</div><div>${order.qty ?? 1}</div></div>
    <div class="row"><div>Per seat (incl. tax & fees)</div><div>${£(order.unit_price_cents)}</div></div>
    <hr/>
    <div class="row"><div>Base (total)</div><div>${£(order.base_cents)}</div></div>
    <div class="row"><div>Tax (total)</div><div>${£(order.tax_cents)}</div></div>
    <div class="row"><div>Fees (total)</div><div>${£(order.fees_cents)}</div></div>
    <hr/>
    <div class="row total"><div>Total</div><div>${£(order.total_cents)}</div></div>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
