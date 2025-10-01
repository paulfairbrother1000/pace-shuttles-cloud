// app/book/country/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Country = { id: string; name: string; description?: string | null; picture_url?: string | null };
type RouteRow = {
  id: string; country_id: string | null; is_active?: boolean | null;
  season_from?: string | null; season_to?: string | null;
};

function startOfDay(d: Date) { const x = new Date(d); x.setHours(12,0,0,0); return x; }
function withinSeason(day: Date, from?: string | null, to?: string | null): boolean {
  if (!from && !to) return true;
  const t = startOfDay(day).getTime();
  if (from) { const f = new Date(from + "T12:00:00").getTime(); if (t < f) return false; }
  if (to)   { const tt = new Date(to + "T12:00:00").getTime(); if (t > tt) return false; }
  return true;
}

export default function Page() {
  const router = useRouter();
  const [countries, setCountries] = useState<Country[]>([]);
  const [liveCountryIds, setLiveCountryIds] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await sb.from("countries").select("id,name,description,picture_url").order("name");
      if (error) return setMsg(error.message);
      setCountries((data as Country[]) || []);
    })();
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      const { data } = await sb
        .from("routes")
        .select("id,country_id,is_active,season_from,season_to");
      if (off || !data) return;
      const today = startOfDay(new Date());
      const ok = new Set<string>();
      (data as RouteRow[]).forEach(r => {
        if (!r?.is_active || !r?.country_id) return;
        if (!withinSeason(today, r.season_from ?? null, r.season_to ?? null)) return;
        ok.add(r.country_id);
      });
      setLiveCountryIds(ok);
    })();
    return () => { off = true; };
  }, []);

  const liveCountries = useMemo(
    () => countries.filter(c => liveCountryIds.has(c.id)),
    [countries, liveCountryIds]
  );

  function go(countryId: string) {
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
          <img src={c.picture_url} alt={c.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
        ) : <div className="absolute inset-0 grid place-items-center text-xs text-neutral-500">No image</div>}
      </div>
      <div className="p-3">
        <div className="font-medium">{c.name}</div>
        {c.description && <div className="mt-1 text-sm text-neutral-600">{c.description}</div>}
      </div>
    </button>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Choose country</h1>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </header>

      {liveCountries.length === 0 ? (
        countries.length === 0 ? (
          <section className="rounded-2xl border p-4 bg-white">No countries available yet.</section>
        ) : (
          <section className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
            {countries.map((c) => <CountryTile key={c.id} c={c} />)}
          </section>
        )
      ) : (
        <section className="columns-1 sm:columns-2 lg:columns-3 gap-4 [column-fill:_balance]">
          {liveCountries.map((c) => <CountryTile key={c.id} c={c} />)}
        </section>
      )}
    </div>
  );
}
