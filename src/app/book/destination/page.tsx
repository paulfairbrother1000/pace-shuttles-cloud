// app/book/destination/page.tsx
"use client";

import * as React from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import WizardHeader from "@/components/WizardHeader";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Destination = {
  id: string;
  name: string;
  country_id: string | null;
  picture_url?: string | null;
  description?: string | null;
  url?: string | null;
  gift?: string | null;
  wet_or_dry?: "wet" | "dry" | null;
};
type RouteRow = {
  id: string;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  is_active?: boolean | null;
  season_from?: string | null;
  season_to?: string | null;
};
type Assignment = { id: string; route_id: string; vehicle_id: string; is_active?: boolean | null };
type Vehicle = { id: string; active?: boolean | null };
type PickupLite = { id: string; transport_type_id: string };

/* ---------- Helpers ---------- */
function startOfDay(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); return x; }
function withinSeason(day: Date, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const t = startOfDay(day).getTime();
  if (from) { const f = new Date(from + "T12:00:00").getTime(); if (t < f) return false; }
  if (to)   { const tt = new Date(to + "T12:00:00").getTime(); if (t > tt) return false; }
  return true;
}
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/* ---------- Page ---------- */
export default function DestinationPage(): JSX.Element {
  const sp = useSearchParams();
  const router = useRouter();

  const countryId = sp.get("country_id") || "";
  const journeyTypeId = sp.get("journey_type_id") || ""; // transport_types.id

  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const [routes, setRoutes] = React.useState<RouteRow[]>([]);
  const [assignments, setAssignments] = React.useState<Assignment[]>([]);
  const [vehicles, setVehicles] = React.useState<Vehicle[]>([]);
  const [pickupsById, setPickupsById] = React.useState<Map<string, PickupLite>>(new Map());

  const [destinations, setDestinations] = React.useState<Destination[]>([]);
  const [thumbs, setThumbs] = React.useState<Record<string, string | null>>({});

  // guard
  React.useEffect(() => {
    if (!countryId) router.replace("/book/country");
  }, [countryId, router]);

  // 1) Load active/in-season routes for this country
  React.useEffect(() => {
    if (!countryId) return;
    let off = false;
    (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("routes")
        .select("id,country_id,pickup_id,destination_id,is_active,season_from,season_to")
        .eq("country_id", countryId)
        .eq("is_active", true);

      if (off) return;
      if (error) { setMsg(error.message); setRoutes([]); setLoading(false); return; }

      const today = startOfDay(new Date());
      const activeInSeasonRoutes = ((data as RouteRow[]) || []).filter((row) =>
        withinSeason(today, row.season_from ?? null, row.season_to ?? null)
      );
      setRoutes(activeInSeasonRoutes);
      setLoading(false);
    })();
    return () => { off = true; };
  }, [countryId]);

  // 2) For those routes, load assignments + vehicles (must be active)
  React.useEffect(() => {
    let off = false;
    (async () => {
      const routeIds = routes.map(r => r.id);
      if (!routeIds.length) { setAssignments([]); setVehicles([]); return; }

      const { data: aData, error: aErr } = await sb
        .from("route_vehicle_assignments")
        .select("id,route_id,vehicle_id,is_active")
        .in("route_id", routeIds)
        .eq("is_active", true);
      if (off) return;
      if (aErr) { setMsg(aErr.message); setAssignments([]); setVehicles([]); return; }
      const asn = (aData as Assignment[]) || [];
      setAssignments(asn);

      const vehicleIds = Array.from(new Set(asn.map(a => a.vehicle_id)));
      if (!vehicleIds.length) { setVehicles([]); return; }

      const { data: vData, error: vErr } = await sb
        .from("vehicles")
        .select("id,active")
        .in("id", vehicleIds)
        .eq("active", true);
      if (off) return;
      if (vErr) { setMsg(vErr.message); setVehicles([]); return; }
      setVehicles((vData as Vehicle[]) || []);
    })();
    return () => { off = true; };
  }, [routes]);

  // 3) Load pickup_points for these routes to get transport_type_id
  React.useEffect(() => {
    let off = false;
    (async () => {
      const pickupIds = Array.from(new Set(routes.map(r => r.pickup_id).filter(Boolean) as string[]));
      if (!pickupIds.length) { setPickupsById(new Map()); return; }

      const { data, error } = await sb
        .from("pickup_points")
        .select("id,transport_type_id")
        .in("id", pickupIds);
      if (off) return;
      if (error) { setMsg(error.message); setPickupsById(new Map()); return; }

      const map = new Map<string, PickupLite>();
      (data as { id: string; transport_type_id: string }[]).forEach(p => {
        map.set(p.id, { id: p.id, transport_type_id: p.transport_type_id });
      });
      setPickupsById(map);
    })();
    return () => { off = true; };
  }, [routes]);

  // 4) Compute verified routes (has active assignment to active vehicle) and match selected transport type (if any)
  const verifiedRoutes = React.useMemo(() => {
    if (!routes.length || !assignments.length || !vehicles.length) return [];

    const activeVeh = new Set(vehicles.filter(v => v.active !== false).map(v => v.id));
    const routeIdsWithActiveVeh = new Set<string>();
    assignments.forEach(a => {
      if (a.is_active === false) return;
      if (activeVeh.has(a.vehicle_id)) routeIdsWithActiveVeh.add(a.route_id);
    });

    return routes.filter(r => {
      if (!routeIdsWithActiveVeh.has(r.id)) return false;
      if (!journeyTypeId) return true; // if type not provided, allow all verified
      if (!r.pickup_id) return false;
      const pu = pickupsById.get(r.pickup_id);
      return !!pu && pu.transport_type_id === journeyTypeId;
    });
  }, [routes, assignments, vehicles, pickupsById, journeyTypeId]);

  // 5) Load just the destinations we actually need
  React.useEffect(() => {
    let off = false;
    (async () => {
      const destIds = Array.from(
        new Set(verifiedRoutes.map(r => r.destination_id).filter(Boolean) as string[])
      );
      if (!destIds.length) { setDestinations([]); return; }

      const { data, error } = await sb
        .from("destinations")
        .select("id,name,country_id,picture_url,description,url,gift,wet_or_dry")
        .in("id", destIds)
        .order("name");
      if (off) return;
      if (error) { setMsg(error.message); setDestinations([]); return; }
      setDestinations((data as Destination[]) || []);
    })();
    return () => { off = true; };
  }, [verifiedRoutes]);

  // 6) Thumbs
  React.useEffect(() => {
    let off = false;
    (async () => {
      const want: [string, string | null][] = [];
      destinations.forEach(d => want.push([`dest_${d.id}`, d.picture_url ?? null]));
      const entries = await Promise.all(want.map(async ([k, v]) => [k, await resolveStorageUrl(v)]));
      if (!off) setThumbs(Object.fromEntries(entries));
    })();
    return () => { off = true; };
  }, [destinations]);

  // UI bits
  const DestinationTile: React.FC<{ d: Destination }> = ({ d }) => (
    <button
      className="break-inside-avoid block w-full text-left rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow hover:shadow-md transition mb-4"
      onClick={() => {
        const qp = new URLSearchParams({
          country_id: countryId,
          destination_id: d.id,
        });
        if (journeyTypeId) qp.set("journey_type_id", journeyTypeId);
        router.push(`/book/date?${qp.toString()}`);
      }}
      title={`Choose ${d.name}`}
    >
      <div className="relative w-full aspect-[16/9] bg-neutral-100">
        {thumbs[`dest_${d.id}`] ? (
          <img src={thumbs[`dest_${d.id}`] as string} alt={d.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>}
      </div>
      <div className="p-3">
        <div className="font-medium">{d.name}</div>
        {d.description && <div className="mt-1 text-sm text-neutral-700">{d.description}</div>}
        {d.gift && <div className="mt-1 text-sm text-emerald-700">🎁 {d.gift}</div>}
        {d.wet_or_dry === "wet" && (
          <div className="mt-1 text-sm text-amber-700">
            There is no dock at this destination. Guests are invited to wade from the boat to the beach with the assistance of the crew. You will get wet leaving the boat at your destination.
          </div>
        )}
        {d.url && (
          <a href={d.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm text-blue-600 underline" onClick={(e) => e.stopPropagation()}>
            {d.url}
          </a>
        )}
      </div>
    </button>
  );

  const countryName = ""; // optional: fetch and show if you want

  // Debug line if empty—helps confirm data flow fast
  const debug =
    destinations.length === 0 ? (
      <div className="text-xs text-neutral-500 mt-2">
        Debug: routes={routes.length}, verified={verifiedRoutes.length}, assignments={assignments.length}, vehicles={vehicles.length}, pickups={pickupsById.size}, type={journeyTypeId ? "set" : "none"}
      </div>
    ) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <WizardHeader step={3} />

      <div className="flex items-center gap-2">
        <a className="rounded-full px-3 py-1 border text-sm" href="/book/country">← change country</a>
        <a
          className="rounded-full px-3 py-1 border text-sm"
          href={`/book/type?country_id=${countryId}`}
        >
          ← change type
        </a>
      </div>

      <h1 className="text-2xl font-semibold">Choose destination</h1>
      {countryName && <p className="text-neutral-600">Country: {countryName}</p>}
      {msg && <p className="text-sm text-red-600">{msg}</p>}

      {loading ? (
        <section className="rounded-2xl border p-4 bg-white">Loading destinations…</section>
      ) : destinations.length === 0 ? (
        <section className="rounded-2xl border p-4 bg-white">
          No destinations available for the current filters.
          {debug}
        </section>
      ) : (
        <section className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {destinations.map((d) => <DestinationTile key={d.id} d={d} />)}
        </section>
      )}
    </div>
  );
}
