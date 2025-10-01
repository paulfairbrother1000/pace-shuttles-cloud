"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import WizardHeader from "@/components/WizardHeader";

type RouteRow = {
  id: string; country_id: string | null;
  is_active: boolean | null;
  season_from?: string | null; season_to?: string | null;
};
type Assignment = { id: string; route_id: string; vehicle_id: string; is_active: boolean | null; };
type Vehicle = { id: string; active: boolean | null; type_id?: string | null; name?: string | null; };
type TransportType = { id: string; name: string; is_active: boolean | null; picture_url?: string | null; description?: string | null; };

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const isUUID = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
function withinSeason(day: Date, from?: string | null, to?: string | null) {
  if (!from && !to) return true;
  const t = new Date(day); t.setHours(12,0,0,0);
  const x = t.getTime();
  if (from) { const f = new Date(from + "T12:00:00").getTime(); if (x < f) return false; }
  if (to)   { const tt = new Date(to + "T12:00:00").getTime(); if (x > tt) return false; }
  return true;
}

export default function TypePage(): JSX.Element {
  const sp = useSearchParams();
  const router = useRouter();

  const country_id = sp.get("country_id") || "";

  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [types, setTypes] = React.useState<TransportType[]>([]);

  // guard
  React.useEffect(() => {
    if (!country_id) router.replace("/book/country");
  }, [country_id, router]);

  React.useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true); setMsg(null);
      try {
        // 1) routes in country
        const { data: rData, error: rErr } = await sb
          .from("routes")
          .select("id,country_id,is_active,season_from,season_to")
          .eq("country_id", country_id)
          .eq("is_active", true);
        if (rErr) throw rErr;
        const today = new Date();
        const routes = (rData as RouteRow[]).filter(r => withinSeason(today, r.season_from ?? null, r.season_to ?? null));
        if (!routes.length) { setTypes([]); setLoading(false); return; }
        const routeIds = routes.map(r => r.id);

        // 2) active assignments for those routes
        const { data: aData, error: aErr } = await sb
          .from("route_vehicle_assignments")
          .select("id,route_id,vehicle_id,is_active")
          .in("route_id", routeIds)
          .eq("is_active", true);
        if (aErr) throw aErr;
        const asn = (aData as Assignment[]) || [];
        if (!asn.length) { setTypes([]); setLoading(false); return; }

        // 3) active vehicles from the assignments
        const vehicleIds = Array.from(new Set(asn.map(a => a.vehicle_id)));
        const { data: vData, error: vErr } = await sb
          .from("vehicles")
          .select("id,active,type_id,name")
          .in("id", vehicleIds)
          .eq("active", true);
        if (vErr) throw vErr;
        const vehicles = (vData as Vehicle[]) || [];
        if (!vehicles.length) { setTypes([]); setLoading(false); return; }

        // Gather possible type ids + names from vehicles
        const typeIdSet = new Set<string>();
        const typeNameSet = new Set<string>(); // legacy name fallback
        vehicles.forEach(v => {
          const raw = (v.type_id || "").trim();
          if (!raw) return;
          if (isUUID(raw)) typeIdSet.add(raw);
          typeNameSet.add(raw.toLowerCase());
        });

        // 4) pull transport_types
        const { data: ttData, error: ttErr } = await sb
          .from("transport_types")
          .select("id,name,is_active,picture_url,description");
        if (ttErr) throw ttErr;

        const all = (ttData as TransportType[]) || [];
        const match = all.filter(t => {
          if (t.is_active === false) return false;
          const idHit = typeIdSet.has(t.id);
          const nmHit = t.name ? typeNameSet.has(t.name.trim().toLowerCase()) : false;
          return idHit || nmHit;
        }).sort((a,b) => (a.name||"").localeCompare(b.name||""));

        if (!off) setTypes(match);
      } catch (e: any) {
        if (!off) setMsg(e?.message || "Failed to load transport types.");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [country_id]);

  // Auto-advance when only one type exists (→ use journey_type_id consistently)
  React.useEffect(() => {
    if (!loading && types.length === 1) {
      const t = types[0];
      const qp = new URLSearchParams({ country_id, journey_type_id: t.id });
      router.replace(`/book/destination?${qp.toString()}`);
    }
  }, [loading, types, router, country_id]);

  function goDest(t: TransportType) {
    const qp = new URLSearchParams({ country_id, journey_type_id: t.id });
    router.push(`/book/destination?${qp.toString()}`);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <WizardHeader step={2} />

      <h1 className="text-2xl font-semibold">Choose transport type</h1>
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {loading ? (
        <section className="rounded-2xl border bg-white p-5 shadow">Loading…</section>
      ) : types.length === 0 ? (
        <section className="rounded-2xl border bg-white p-5 shadow">
          <p className="text-neutral-700">No transport types available for the selected country (based on routes with active vehicle assignments).</p>
        </section>
      ) : (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {types.map(t => (
            <button key={t.id}
              onClick={() => goDest(t)}
              className="rounded-2xl border bg-white overflow-hidden shadow hover:shadow-md text-left"
              title={`Choose ${t.name}`}>
              <div className="relative w-full aspect-[16/9] bg-neutral-100">
                {t.picture_url ? (
                  <img src={t.picture_url} alt={t.name} className="absolute inset-0 w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>
                )}
              </div>
              <div className="p-3">
                <div className="font-medium">{t.name}</div>
                {t.description && <div className="mt-1 text-sm text-neutral-600">{t.description}</div>}
              </div>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
