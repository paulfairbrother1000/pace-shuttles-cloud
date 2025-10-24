"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient, type SupabaseClient } from "@supabase/ssr";

/* ---------- Types ---------- */
type PsUser = { operator_admin?: boolean | null; operator_id?: string | null };

type WlAsset = {
  wl_asset_id: string;
  vehicle_id: string;
  vehicle_name: string;
  seats_capacity: number | null;
  day_rate_cents: number;
  security_deposit_cents: number;
  min_notice_hours: number | null;
  owner_operator_id: string;
  owner_operator_name: string;
  country_id: string | null;
  vehicle_description: string | null;
  vehicle_picture_url: string | null;  // storage path or http
  vehicle_type_id: string | null;
};

type Unavail = { start_ts: string; end_ts: string; source: "wl" | "blackout" | "ps_confirmed" | "ps_paid" | string };

/* ---------- Helpers ---------- */
function readPsUser(): PsUser | null {
  try { return JSON.parse(localStorage.getItem("ps_user") || "null"); } catch { return null; }
}
function isHttp(url?: string | null) { return !!url && /^https?:\/\//i.test(url); }
const money = (cents?: number | null) =>
  cents == null ? "—" : `US$ ${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

async function resolveSignedImage(sb: SupabaseClient, pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/* Fixed day charter window */
const PICKUP_TIME = "09:00";
const RETURN_TIME = "18:00";

/* Build yyyy-mm-dd */
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/* Expand timestamptz range into a set of days */
function daysCovered(startIso: string, endIso: string): string[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  // normalize to date boundaries
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const last = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const out: string[] = [];
  while (d <= last) {
    out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/* ====================================================================== */

export default function OperatorWhiteLabelPage() {
  const sb: SupabaseClient | null = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && key ? createBrowserClient(url, key) : null;
  }, []);

  const [psUser, setPsUser] = useState<PsUser | null>(null);

  /* Data */
  const [assets, setAssets] = useState<WlAsset[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({}); // wl_asset_id -> signed URL
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Selection */
  const [selected, setSelected] = useState<WlAsset | null>(null);
  const [heroUrl, setHeroUrl] = useState<string | null>(null);

  /* Availability (preloaded blocked days) */
  const [date, setDate] = useState("");
  const [blockedDays, setBlockedDays] = useState<Set<string>>(new Set());
  const [blockedRanges, setBlockedRanges] = useState<Unavail[]>([]);
  const [availMsg, setAvailMsg] = useState<string | null>(null);

  /* T&Cs */
  const [agree, setAgree] = useState({
    insurance: false,
    crew: false,
    cleanFuel: false,
    damages: false,
    deposit: false,
  });

  /* Booking actions */
  const [creating, setCreating] = useState(false);
  const [charterId, setCharterId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => { setPsUser(readPsUser()); }, []);

  /* Load market assets for current operator */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);
      if (!sb) { setMsg("Supabase not available."); setLoading(false); return; }

      const operatorId = psUser?.operator_admin ? psUser?.operator_id ?? null : null;
      if (!operatorId) { setMsg("You must be an Operator Admin to use White Label."); setLoading(false); return; }

      const { data, error } = await sb.rpc("wl_market_for_operator", { p_operator_id: operatorId });
      if (off) return;

      if (error) {
        setMsg(error.message);
        setAssets([]);
      } else {
        const rows = (data as WlAsset[]) || [];
        setAssets(rows);

        // Pre-resolve card thumbnails
        const entries = await Promise.all(
          rows.map(async (r) => [r.wl_asset_id, await resolveSignedImage(sb, r.vehicle_picture_url)] as const)
        );
        setThumbs(Object.fromEntries(entries));
      }

      setLoading(false);
    })();
    return () => { off = true; };
  }, [sb, psUser]);

  /* Resolve hero image whenever selection changes */
  useEffect(() => {
    let off = false;
    (async () => {
      setHeroUrl(null);
      if (!sb || !selected) return;
      const url = await resolveSignedImage(sb, selected.vehicle_picture_url || null);
      if (!off) setHeroUrl(url);
    })();
    return () => { off = true; };
  }, [sb, selected]);

  /* Preload next 90 days of blocks for selected asset */
  useEffect(() => {
    let off = false;
    (async () => {
      setBlockedDays(new Set());
      setBlockedRanges([]);
      setAvailMsg(null);
      setDate("");

      if (!sb || !selected) return;

      const now = new Date();
      const fromIso = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
      const to = new Date(now.getTime() + 90 * 86400000);
      const toIso = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate(), 23, 59, 59)).toISOString();

      const { data, error } = await sb.rpc("wl_asset_unavailability", {
        p_wl_asset_id: selected.wl_asset_id,
        p_from: fromIso,
        p_to: toIso,
      });
      if (off) return;

      if (error) { setMsg(error.message); return; }

      const ranges = (data as Unavail[]) || [];
      setBlockedRanges(ranges);

      // Turn ranges into a set of yyyy-mm-dd strings
      const set = new Set<string>();
      for (const r of ranges) {
        for (const d of daysCovered(r.start_ts, r.end_ts)) set.add(d);
      }
      setBlockedDays(set);
    })();
    return () => { off = true; };
  }, [sb, selected]);

  /* When date changes, show immediate availability hint */
  useEffect(() => {
    if (!date) { setAvailMsg(null); return; }
    if (blockedDays.has(date)) setAvailMsg("❌ Not available on that date.");
    else                       setAvailMsg("✅ Available on that date.");
  }, [date, blockedDays]);

  const allAgreed =
    agree.insurance && agree.crew && agree.cleanFuel && agree.damages && agree.deposit;

  function dayWindowISO(d: string) {
    const startIso = new Date(`${d}T${PICKUP_TIME}:00Z`).toISOString();
    const endIso   = new Date(`${d}T${RETURN_TIME}:00Z`).toISOString();
    return { startIso, endIso };
  }

  /* Create booking (pending) using fixed times */
  async function createBooking() {
    setMsg(null);
    if (!sb || !selected) return;
    if (!date) { setMsg("Pick a date."); return; }
    if (!allAgreed) { setMsg("Please accept all T&Cs to continue."); return; }
    if (blockedDays.has(date)) { setMsg("Selected date is unavailable."); return; }

    const operatorId = psUser?.operator_admin ? psUser?.operator_id ?? null : null;
    if (!operatorId) { setMsg("Missing operator context."); return; }

    const { startIso, endIso } = dayWindowISO(date);

    setCreating(true);
    const { data, error } = await sb.rpc("wl_create_booking", {
      p_wl_asset_id: selected.wl_asset_id,
      p_lessee_operator_id: operatorId,
      p_start_ts: startIso,
      p_end_ts: endIso,
      p_terms_version: "v1",
    });
    setCreating(false);

    if (error) { setMsg(error.message); return; }
    setCharterId(String(data));
    setMsg("Booking created (pending). You can confirm (MVP) to simulate payment.");
  }

  /* Confirm booking (MVP) */
  async function confirmBooking() {
    if (!sb || !charterId) return;
    setConfirming(true);
    const { error } = await sb.rpc("wl_confirm_booking", { p_charter_id: charterId });
    setConfirming(false);
    if (error) { setMsg(error.message); return; }
    setMsg("✅ Booking confirmed.");
  }

  return (
    <>
      {/* Hide legacy operator sub-nav on this page only */}
      <style jsx global>{`
        #operator-tabs,
        .operator-tabs,
        .operator-section-tabs,
        nav[aria-label="Operator sections"] {
          display: none !important;
        }
      `}</style>

      <div className="max-w-5xl mx-auto p-4 space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">White Label — Day Charter</h1>
          <p className="text-neutral-600">
            Hire an owner boat for your own charter. Pick a boat, check availability, accept T&Cs, then confirm.
          </p>
        </header>

        {loading ? (
          <div className="p-4">Loading…</div>
        ) : assets.length === 0 ? (
          <div className="p-4">No white label boats available right now.</div>
        ) : (
          <>
            {/* 1) Boat list with image tiles */}
            <section className="grid md:grid-cols-2 gap-4">
              {assets.map(a => {
                const thumb = thumbs[a.wl_asset_id] || null;
                const desc = (a.vehicle_description || "").trim();
                const shortDesc = desc.length > 120 ? desc.slice(0, 117) + "…" : desc;

                return (
                  <button
                    key={a.wl_asset_id}
                    className={`text-left rounded-2xl border overflow-hidden shadow-sm transition ${
                      selected?.wl_asset_id === a.wl_asset_id
                        ? "border-black"
                        : "border-neutral-200 hover:border-neutral-400"
                    }`}
                    onClick={() => {
                      setSelected(a);
                      setCharterId(null);
                      setAvailMsg(null);
                      setDate("");
                    }}
                  >
                    {thumb ? (
                      <img src={thumb} alt={a.vehicle_name} className="w-full h-40 object-cover" />
                    ) : (
                      <div className="w-full h-40 bg-neutral-100" />
                    )}
                    <div className="p-4">
                      <div className="text-lg font-semibold">{a.vehicle_name}</div>
                      <div className="text-xs text-neutral-500">Owner: {a.owner_operator_name}</div>
                      {shortDesc && <p className="text-sm mt-1">{shortDesc}</p>}
                      <div className="mt-2 text-sm">
                        Seats: <b>{a.seats_capacity ?? "—"}</b>
                      </div>
                      <div className="text-sm">
                        Day rate: <b>{money(a.day_rate_cents)}</b> • Deposit: <b>{money(a.security_deposit_cents)}</b>
                      </div>
                    </div>
                  </button>
                );
              })}
            </section>

            {/* 2) Selected boat hero + details */}
            {selected && (
              <section className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
                {heroUrl ? (
                  <img src={heroUrl} alt={selected.vehicle_name} className="w-full max-h-80 object-cover" />
                ) : (
                  <div className="w-full h-48 bg-neutral-100" />
                )}

                <div className="p-4 space-y-2">
                  <div className="text-xl font-semibold">{selected.vehicle_name}</div>
                  <div className="text-sm text-neutral-600">
                    Seats: <b>{selected.seats_capacity ?? "—"}</b>
                  </div>
                  {selected.vehicle_description && (
                    <p className="text-sm">{selected.vehicle_description}</p>
                  )}
                  <div className="text-sm">
                    Day rate: <b>{money(selected.day_rate_cents)}</b> • Deposit: <b>{money(selected.security_deposit_cents)}</b>
                  </div>
                </div>

                {/* 3) Availability (date only) + pickup/return rules + blocked days panel */}
                <div className="p-4 space-y-3 border-t">
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm text-neutral-600 mb-1">Charter date</label>
                      <input
                        type="date"
                        className="w-full border rounded-lg px-3 py-2"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                      />
                      {availMsg && <div className="mt-2 text-sm">{availMsg}</div>}
                    </div>
                    <div className="text-sm bg-neutral-50 border rounded-lg p-3">
                      <div className="font-semibold">Pickup & return</div>
                      <ul className="list-disc ml-5">
                        <li>Pickup from <b>{PICKUP_TIME}</b></li>
                        <li>Return by <b>{RETURN_TIME}</b></li>
                        <li>Remove all rubbish</li>
                        <li>Hose down the vessel</li>
                        <li>Refuel to <b>full</b></li>
                      </ul>
                    </div>
                  </div>

                  {/* blocked days list */}
                  <div className="rounded-xl border p-3">
                    <div className="font-semibold mb-2">Unavailable days (next 90 days)</div>
                    {blockedDays.size === 0 ? (
                      <div className="text-sm text-neutral-600">No blocked days.</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {[...blockedDays].sort().map(d => (
                          <span key={d} className="text-xs px-2 py-1 rounded-full border">{d}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* 4) T&Cs — all must be checked */}
                <div className="p-4 border-t">
                  <div className="rounded-xl border p-3">
                    <div className="font-semibold mb-2">Terms & Conditions (summary)</div>
                    <label className="block"><input type="checkbox" checked={agree.insurance} onChange={e=>setAgree(a=>({...a,insurance:e.target.checked}))} /> I have appropriate insurance for this charter.</label>
                    <label className="block"><input type="checkbox" checked={agree.crew} onChange={e=>setAgree(a=>({...a,crew:e.target.checked}))} /> My crew are insured and certified.</label>
                    <label className="block"><input type="checkbox" checked={agree.cleanFuel} onChange={e=>setAgree(a=>({...a,cleanFuel:e.target.checked}))} /> I will return the vessel cleaned and full of fuel.</label>
                    <label className="block"><input type="checkbox" checked={agree.damages} onChange={e=>setAgree(a=>({...a,damages:e.target.checked}))} /> I accept liability for damages caused to/by the vessel.</label>
                    <label className="block"><input type="checkbox" checked={agree.deposit} onChange={e=>setAgree(a=>({...a,deposit:e.target.checked}))} /> I agree to the security deposit.</label>
                    <div className="text-xs text-neutral-500 mt-2">We store <code>terms_version</code> with the booking.</div>
                  </div>
                </div>

                {/* 5) Create booking (pending) & 6) Confirm (MVP) */}
                <div className="p-4 border-t flex gap-2">
                  <button
                    className="rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
                    disabled={creating || !date || blockedDays.has(date) || !allAgreed}
                    onClick={createBooking}
                  >
                    {creating ? "Creating…" : "Create booking (pending)"}
                  </button>

                  <button
                    className="rounded-full px-4 py-2 border text-sm disabled:opacity-50"
                    disabled={!charterId || confirming}
                    onClick={confirmBooking}
                  >
                    {confirming ? "Confirming…" : "Pay now (confirm)"}
                  </button>

                  {charterId && <span className="text-sm">Booking ID: {charterId}</span>}
                  {msg && <span className="text-sm">{msg}</span>}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
