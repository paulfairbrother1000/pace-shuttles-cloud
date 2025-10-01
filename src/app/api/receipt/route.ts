// src/app/api/receipt/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function moneyFromCents(cents: number | null | undefined, currency: string) {
  const v = (cents ?? 0) / 100;
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: currency || "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(v);
  } catch {
    // Fallback if currency code is unexpected
    return `${currency || "GBP"} ${v.toFixed(2)}`;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const orderId = url.searchParams.get("orderId") || url.searchParams.get("id") || "";
    const s = url.searchParams.get("s") || url.searchParams.get("token") || "";

    if (!orderId || !s) {
      return new NextResponse("Missing order params", { status: 400 });
    }

    if (!SUPABASE_URL || !SUPABASE_ANON) {
      return new NextResponse("Supabase env not configured", { status: 500 });
    }

    // Next 15: cookies() must be awaited before use
    const jar = await cookies();

    const sb = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => {
          jar.set(name, value, options);
        },
        remove: (name, options) => {
          jar.set(name, "", { ...options, maxAge: 0 });
        },
      },
    });

    // Load order by public success token (RLS should allow this select)
    const { data: order, error: oerr } = await sb
      .from("orders")
      .select(
        [
          "id",
          "created_at",
          "status",
          "currency",
          "unit_price_cents",
          "base_cents",
          "tax_cents",
          "fees_cents",
          "total_cents",
          "qty",
          "route_id",
          "journey_date",
          "lead_first_name",
          "lead_last_name",
          "lead_email",
          "lead_phone",
          "bill_addr_line1",
          "bill_addr_line2",
          "bill_city",
          "bill_region",
          "bill_postal",
          "bill_country",
          "success_token",
          "card_last4",
        ].join(",")
      )
      .eq("id", orderId)
      .maybeSingle();

    if (oerr || !order) {
      return new NextResponse("Order not found", { status: 404 });
    }
    if (!order.success_token || order.success_token !== s) {
      return new NextResponse("Invalid receipt token", { status: 403 });
    }

    // Optional: load guest names if you have order_guests table
    let guests: Array<{ first_name: string | null; last_name: string | null }> = [];
    try {
      const { data: g } = await sb
        .from("order_guests")
        .select("first_name,last_name")
        .eq("order_id", order.id);
      guests = (g as any[]) || [];
    } catch {
      // Ignore if table doesn't exist or RLS blocks
    }

    const currency = order.currency || "GBP";
    const created = order.created_at
      ? new Date(order.created_at).toLocaleString("en-GB")
      : "";
    const journey = order.journey_date
      ? new Date(order.journey_date + "T12:00:00").toLocaleDateString("en-GB")
      : "";

    const lines: string[] = [];
    lines.push("PACE SHUTTLES — RECEIPT");
    lines.push("====================================");
    lines.push(`Order ID:        ${order.id}`);
    lines.push(`Created:         ${created}`);
    lines.push(`Status:          ${order.status}`);
    lines.push("");
    lines.push(`Journey date:    ${journey}`);
    lines.push(`Route ID:        ${order.route_id ?? "-"}`);
    lines.push(`Tickets (qty):   ${order.qty ?? 0}`);
    lines.push("");
    lines.push("Price (per ticket):");
    lines.push(`  Base:          ${moneyFromCents(order.base_cents, currency)}`);
    lines.push(`  Tax:           ${moneyFromCents(order.tax_cents, currency)}`);
    lines.push(`  Fees:          ${moneyFromCents(order.fees_cents, currency)}`);
    lines.push(`  Unit price:    ${moneyFromCents(order.unit_price_cents, currency)}`);
    lines.push("");
    lines.push(`Total:           ${moneyFromCents(order.total_cents, currency)}`);
    lines.push("");
    lines.push("Lead passenger:");
    lines.push(
      `  Name:          ${
        [order.lead_first_name, order.lead_last_name].filter(Boolean).join(" ") || "-"
      }`
    );
    lines.push(`  Email:         ${order.lead_email || "-"}`);
    lines.push(`  Phone:         ${order.lead_phone || "-"}`);
    lines.push("");
    lines.push("Billing address:");
    const addr = [
      order.bill_addr_line1,
      order.bill_addr_line2,
      order.bill_city,
      order.bill_region,
      order.bill_postal,
      order.bill_country,
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`  ${addr || "-"}`);
    lines.push("");
    if (order.card_last4) {
      lines.push(`Card:            •••• •••• •••• ${order.card_last4}`);
      lines.push("");
    }
    if (guests.length) {
      lines.push("Guests:");
      guests.forEach((g, i) => {
        const nm = [g.first_name, g.last_name].filter(Boolean).join(" ");
        lines.push(`  ${i + 1}. ${nm || "-"}`);
      });
      lines.push("");
    }
    lines.push("Thank you for travelling with us!");

    const body = lines.join("\n");
    const headers = new Headers({
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="receipt-${order.id}.txt"`,
      "Cache-Control": "no-store",
    });
    return new NextResponse(body, { status: 200, headers });
  } catch (e: any) {
    console.error("[/api/receipt] error", e);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
