// src/app/api/email/booking-request/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { renderBookingEmailHTML, renderBookingEmailText } from "@/lib/email/templates";
import { sendMail } from "@/lib/email/mailer";

type Body = {
  qid?: string;
  routeId: string;
  date: string; // YYYY-MM-DD
  qty: number;
  token: string;
  perSeatAllIn: number;
  currency: string;
  total: number;

  lead_first_name: string;
  lead_last_name: string;
  lead_email: string;
  lead_phone: string;
};

// server supabase (anon is enough for public reads)
const supa = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;

    // Pull minimal route context for the email
    const { data: route } = await supa
      .from("routes")
      .select(
        "id, route_name, pickup_id, destination_id, pickup_time, countries(timezone)"
      )
      .eq("id", body.routeId)
      .maybeSingle();

    const pickupId = route?.pickup_id || null;
    const destId = route?.destination_id || null;

    const [{ data: pickup }, { data: dest }] = await Promise.all([
      pickupId
        ? supa.from("pickup_points").select("name").eq("id", pickupId).maybeSingle()
        : Promise.resolve({ data: null }),
      destId
        ? supa
            .from("destinations")
            .select("name, url, email, phone, wet_or_dry, arrival_notes")
            .eq("id", destId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const vehicleType = "Shuttle"; // If you want true type, we can join assignments/vehicles later.

    const journeyTime = route?.pickup_time || null;
    const ymd = body.date || null;

    // Google Maps link (best-effort search by pickup name)
    const mapsUrl = pickup?.name
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(pickup.name)}`
      : undefined;

    const isWet = (dest?.wet_or_dry || "").toLowerCase() === "wet";

    const html = renderBookingEmailHTML({
      leadFirst: body.lead_first_name,
      orderRef: body.qid || null, // we can swap to a real order ref when available
      vehicleType,
      routeName: route?.route_name || null,
      journeyDate: ymd,
      journeyTime,
      paymentAmountLabel: new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: body.currency || "GBP",
      }).format(body.total || 0),
      receiptUrl: null, // add when your receipt endpoint is ready

      isWet,
      wetAdviceFromDestination: dest?.arrival_notes || null,

      pickupName: pickup?.name || null,
      pickupMapsUrl: mapsUrl,

      destinationName: dest?.name || null,
      destinationUrl: dest?.url || null,
      destinationEmail: dest?.email || null,
      destinationPhone: dest?.phone || null,

      logoUrl: null,
    });

    const text = renderBookingEmailText({
      leadFirst: body.lead_first_name,
      orderRef: body.qid || null,
      vehicleType,
      routeName: route?.route_name || null,
      journeyDate: ymd,
      journeyTime,
      paymentAmountLabel: new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: body.currency || "GBP",
      }).format(body.total || 0),
      receiptUrl: null,
      isWet,
      wetAdviceFromDestination: dest?.arrival_notes || null,
      pickupName: pickup?.name || null,
      pickupMapsUrl: mapsUrl,
      destinationName: dest?.name || null,
      destinationUrl: dest?.url || null,
      destinationEmail: dest?.email || null,
      destinationPhone: dest?.phone || null,
      logoUrl: null,
    });

    const to = [body.lead_email].filter(Boolean) as string[];
    if (to.length) {
      await sendMail({
        to,
        subject: "Your Pace Shuttles booking confirmation",
        html,
        text,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[email/booking-request] error:", e);
    // Never break checkout redirect flows because of email
    return NextResponse.json({ ok: true, warn: "email_failed" });
  }
}
