// app/book/country/page.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import WizardHeader from "@/components/WizardHeader";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Country = {
  id: string;
  name: string;
  description?: string | null;
  picture_url?: string | null;
};

type RouteRow = {
  id: string;
  country_id: string | null;
  is_active?: boolean | null;
  season_from?: string | null;
  season_to?: string | null;
};

type Assignment = { route_id: string; vehicle_id: string; is_active: boolean | null };
type Vehicle = { id: string; active: boolean | null };

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
}
function withinSeason(day: Date, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const t = startOfDay(day).getTime();
  if (from) {
    const f = new Date(from + "T12:00:00").getTime();
    if (t < f) return false;
  }
  if (to) {
    const tt = new Date(to + "T12:00:00").getTime();
    if (t > tt) return false;
  }
  return true;
}

export default function CountryPage(): JSX.Element {
  const router = useRouter();
  const [countries, setCountries] = React.useState<Country[]>([]);
  const [liveCountryIds, setLiveCountryIds] = React.useState<Set<string>>(new Set());
  const [msg, setMsg] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  // Load all countries for tiles
  React.useEffect(() => {
    (async () => {
      const { data, error } = await sb
        .from("countries")
        .select("id,name,description,picture_url")
        .order("name");
      if (error) setMsg(error.message);
      setCountries((data as Country[]) || []);
    })();
  }, []);

  // Compute "participating" countries = verified journeys exist in-season + active
  React.useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setMsg(null);
      try {
        // 1) Active assignments
        const { data: aData, error: aErr } = await sb
          .from("route_vehicle_assignments")
          .select("route_id,vehicle_id,is_active")
          .eq("is_active", true);
        if (aErr) throw aErr;
        const assignments = (aData as Assignment[]) || [];
        if (!assignments.length) {
          if (!off) setLiveCountryIds(new Set());
          return;
        }

        // 2) Active vehicles for those assignments
        const vehicleIds = Array.from(new Set(assignments.map((a) => a.vehicle_id)));
        const { data: vData, error: vErr } = await sb
          .from("vehicles")
          .select("id,active")
          .in("id", vehicleIds)
          .eq("active", true);
        if (vErr) throw vErr;
        const activeVehicleIds = new Set(((vData as Vehicle[]) || []).map((v) => v.id));
        if (!activeVehicleIds.size) {
          if (!off) setLiveCountryIds(new Set());
          return;
        }

        // 3) Candidate route ids (those with an active vehicle)
        const routeIds = Array.from(
          new Set(assignments.filter((a) => activeVehicleIds.has(a.vehicle_id)).map((a) => a.route_id))
        );
        if (!routeIds.length) {
          if (!off) setLiveCountryIds(new Set());
          return;
        }

        // 4) Fetch those routes and keep ones active + in-season
        const { data: rData, error: rErr } = await sb
          .from("routes")
          .select("id,country_id,is_active,season_from,season_to")
          .in("id", routeIds)
          .eq("is_active", true);
        if (rErr) throw rErr;

        const today = startOfDay(new Date());
        const okCountryIds = new Set<string>();
        ((rData as RouteRow[]) || []).forEach((r) => {
          if (!r.country_id) return;
          if (!withinSeason(today, r.season_from ?? null, r.season_to ?? null)) return;
          okCountryIds.add(r.country_id);
        });

        if (!off) setLiveCountryIds(okCountryIds);
      } catch (e: any) {
        if (!off) setMsg(e?.message || "Failed to load countries.");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  const liveCountries = React.useMemo(
    () => countries.filter((c) => liveCountryIds.has(c.id)),
    [countries, liveCountryIds]
  );

  function go(countryId: string) {
    // Step 2 expects country_id
    router.push(`/book/type?country_id=${countryId}`);
  }

  const CountryTile: React.FC<{ c: Country }> = ({ c }) => (
    <button
      className="break-inside-avoid block w-full text-left rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow hover:shadow-md transition mb-4"
      onClick={() => go(c.id)}
      title={`Select ${c.name}`}
    >
      <div className="relative w-full aspect-[16/9] bg-neutral-100">
        {c.picture_url ? (
          <img
            src={c.picture_url}
            alt={c.name}
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>
        )}
      </div>
      <div className="p-3">
        <div className="font-medium">{c.name}</div>
        {c.description && <div className="mt-1 text-sm text-neutral-600">{c.description}</div>}
      </div>
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <WizardHeader step={1} />
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Select the country of travel</h1>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </header>

      {loading ? (
        <section className="rounded-2xl border p-4 bg-white">Loading…</section>
      ) : liveCountries.length > 0 ? (
        <section className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {liveCountries.map((c) => (
            <CountryTile key={c.id} c={c} />
          ))}
        </section>
      ) : countries.length > 0 ? (
        // Fallback: show all if none have live journeys (can remove if you prefer a blank state)
        <section className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {countries.map((c) => (
            <CountryTile key={c.id} c={c} />
          ))}
        </section>
      ) : (
        <section className="rounded-2xl border p-4 bg-white">No countries available yet.</section>
      )}
    </div>
  );
}
