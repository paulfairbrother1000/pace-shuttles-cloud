// src/app/checkout/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      )
    : null;

type QuoteIntent = {
  id: string;
  route_id: string;
  date_iso: string;      // "YYYY-MM-DD"
  seats: number;
  per_seat_all_in: number | null;
  currency: string | null;
  quote_token: string | null;
};

type RouteRow = {
  id: string;
  pickup_id: string | null;
  destination_id: string | null;
  pickup_time: string | null;
};

type Point = { id: string; name: string; picture_url?: string | null };

type FreshQuote = { token: string; perSeat: number };

const fmtPounds = (n?: number | null) =>
  n == null
    ? "—"
    : `£${Number(n).toLocaleString("en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const fmtTime = (hhmm?: string | null) => {
  if (!hhmm) return "—";
  try {
    const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
};

// Compatible fetcher for /api/quote (GET/POST + snake/camel)
async function getLiveQuote(routeId: string, dateISO: string, qty: number): Promise<FreshQuote | null> {
  async function tryOne(url: string, opts?: RequestInit) {
    const res = await fetch(url, { cache: "no-store", ...(opts || {}) });
    if (!res.ok) return null;
    return res.json().catch(() => null);
  }
  const tries = [
    () => tryOne(`/api/quote?route_id=${encodeURIComponent(routeId)}&date=${encodeURIComponent(dateISO)}&qty=${qty}`),
    () => tryOne(`/api/quote?routeId=${encodeURIComponent(routeId)}&date=${encodeURIComponent(dateISO)}&qty=${qty}`),
    () => tryOne(`/api/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route_id: routeId, date: dateISO, qty }) }),
    () => tryOne(`/api/quote`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ routeId, date: dateISO, qty }) }),
  ];
  for (const go of tries) {
    const json = await go();
    const token = json?.token ?? json?.quoteToken ?? json?.quote?.token ?? null;
    const perSeat =
      json?.unit_cents != null
        ? Math.ceil(Number(json.unit_cents) / 100)
        : json?.perSeatAllInC ?? json?.quote?.perSeatAllInC ?? json?.allInC ?? json?.quote?.allInC ?? null;
    if (token && Number.isFinite(Number(perSeat))) {
      return { token: String(token), perSeat: Math.ceil(Number(perSeat)) };
    }
  }
  return null;
}

export default function CheckoutPage() {
  const sp = useSearchParams();
  const qid = sp.get("qid");

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [qi, setQi] = useState<QuoteIntent | null>(null);
  const [route, setRoute] = useState<RouteRow | null>(null);
  const [pickup, setPickup] = useState<Point | null>(null);
  const [dest, setDest] = useState<Point | null>(null);

  const [retrying, setRetrying] = useState(false);
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) { setErr("Supabase not configured."); setLoading(false); return; }
      if (!qid) { setErr("Missing quote reference (?qid=...)."); setLoading(false); return; }

      setLoading(true);
      setErr(null);

      try {
        const { data: qrow, error: qerr } = await supabase
          .from("quote_intents")
          .select("id,route_id,date_iso,seats,per_seat_all_in,currency,quote_token")
          .eq("id", qid)
          .maybeSingle();

        if (qerr || !qrow) { setErr(qerr?.message || `Quote not found for qid ${qid}.`); setLoading(false); return; }
        if (off) return;
        setQi(qrow as QuoteIntent);

        const { data: r, error: rerr } = await supabase
          .from("routes")
          .select("id,pickup_id,destination_id,pickup_time")
          .eq("id", (qrow as QuoteIntent).route_id)
          .maybeSingle();

        if (rerr || !r) { setErr(rerr?.message || "Route not found."); setLoading(false); return; }
        setRoute(r as RouteRow);

        const [pu, de] = await Promise.all([
          r?.pickup_id ? supabase.from("pickup_points").select("id,name,picture_url").eq("id", r.pickup_id).maybeSingle()
                        : Promise.resolve({ data: null, error: null }),
          r?.destination_id ? supabase.from("destinations").select("id,name,picture_url").eq("id", r.destination_id).maybeSingle()
                            : Promise.resolve({ data: null, error: null }),
        ]);
        if (pu?.error) setErr(pu.error.message);
        if (de?.error) setErr(de.error.message);
        setPickup((pu?.data as Point) ?? null);
        setDest((de?.data as Point) ?? null);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [qid]);

  const dateText = useMemo(() => {
    if (!qi?.date_iso) return "—";
    const d = new Date(qi.date_iso + "T12:00:00");
    return isNaN(+d) ? qi.date_iso : d.toLocaleDateString("en-GB");
  }, [qi?.date_iso]);

  const total = useMemo(
    () => (qi && qi.per_seat_all_in != null ? qi.per_seat_all_in * (qi.seats ?? 0) : 0),
    [qi]
  );

  const verified = !!qi && Number.isFinite(qi.per_seat_all_in) && !!qi.quote_token;

  async function retryPrice() {
    if (!supabase || !qi?.route_id || !qi?.date_iso || !qi?.seats) return;
    setRetrying(true);
    try {
      const got = await getLiveQuote(qi.route_id, qi.date_iso, qi.seats);
      if (!got) { alert("Could not fetch a live price right now."); setRetrying(false); return; }
      const { error } = await supabase
        .from("quote_intents")
        .update({ per_seat_all_in: got.perSeat, quote_token: got.token })
        .eq("id", qi.id);
      if (error) { alert(error.message); setRetrying(false); return; }
      setQi((prev) => prev ? { ...prev, per_seat_all_in: got.perSeat, quote_token: got.token } : prev);
    } finally {
      setRetrying(false);
    }
  }

  // ✅ Restore original flow: refresh + persist, then navigate to /book/pay
  async function proceedToPayment() {
    if (!supabase || !qi) return;
    setNavigating(true);
    setErr(null);
    try {
      // 1) Fresh single-use token
      const fresh = await getLiveQuote(qi.route_id, qi.date_iso, qi.seats);
      if (!fresh) { setErr("Could not refresh the quote right now."); setNavigating(false); return; }

      // 2) Persist to keep DB and token in sync
      const { error: upErr } = await supabase
        .from("quote_intents")
        .update({ per_seat_all_in: fresh.perSeat, quote_token: fresh.token })
        .eq("id", qi.id);
      if (upErr) { setErr(upErr.message); setNavigating(false); return; }
      setQi((p) => (p ? { ...p, per_seat_all_in: fresh.perSeat, quote_token: fresh.token } : p));

      // 3) Step-2 page handles the actual payment
      const u = new URL("/book/pay", window.location.origin);
      u.searchParams.set("qid", qi.id);
      u.searchParams.set("routeId", qi.route_id);
      u.searchParams.set("date", qi.date_iso);
      u.searchParams.set("qty", String(qi.seats));
      u.searchParams.set("token", fresh.token);
      u.searchParams.set("allInC", String(fresh.perSeat));
      window.location.href = u.toString();
    } catch (e: any) {
      setErr(e?.message ?? "Unexpected error during navigation.");
      setNavigating(false);
    }
  }

  return (
    <div className="max-w-[920px] mx-auto px-4 py-8 space-y-6">
      <h1 className="text-3xl font-semibold">Order confirmation</h1>

      {loading ? (
        <div className="rounded-2xl border bg-white p-4">Loading…</div>
      ) : err ? (
        <div className="rounded-2xl border bg-white p-4 text-red-600">{err}</div>
      ) : !qi || !route ? (
        <div className="rounded-2xl border bg-white p-4">Missing quote.</div>
      ) : (
        <>
          <section className="rounded-2xl border bg-white p-6 shadow">
            <div className="text-2xl font-medium">
              {(pickup?.name ?? "Journey")} <span className="opacity-60">→</span> {(dest?.name ?? "")}
            </div>
            <div className="mt-2 text-neutral-700">
              {dateText} {route?.pickup_time ? `• ${fmtTime(route?.pickup_time)}` : ""}
            </div>
            <div className="mt-2 text-neutral-700">
              {(pickup?.name ?? "—")} <span className="opacity-60">→</span> {(dest?.name ?? "—")}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-6 shadow flex flex-wrap items-center justify-between gap-6">
            <div>
              <div className="text-xl">
                Tickets: <span className="font-semibold">{qi?.seats ?? "—"}</span>
              </div>
              <div className="text-neutral-700 mt-2">
                Per ticket (incl. tax & fees): <span className="font-semibold">{fmtPounds(qi?.per_seat_all_in)}</span>
              </div>
              {!verified && (
                <button
                  onClick={retryPrice}
                  className="mt-3 px-3 py-2 rounded-lg border hover:bg-neutral-50"
                  disabled={retrying}
                >
                  {retrying ? "Fetching price…" : "Retry live price"}
                </button>
              )}
            </div>
            <div className="text-2xl">
              Total: <span className="font-bold">{fmtPounds(total)}</span>
            </div>
          </section>

          <div className="flex gap-3">
            <a href="/" className="px-5 py-3 rounded-2xl border hover:bg-neutral-50">Back</a>
            <button
              className="px-6 py-3 rounded-2xl bg-black text-white hover:bg-neutral-900 disabled:opacity-40"
              disabled={navigating}
              onClick={proceedToPayment}
            >
              {navigating ? "Opening payment…" : "Proceed to payment"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
