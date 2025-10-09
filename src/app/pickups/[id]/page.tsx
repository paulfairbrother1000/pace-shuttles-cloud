"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type Pickup = {
  id: UUID;
  name: string;
  country_id: UUID | null;
  picture_url: string | null;
  description: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  transport_type_id: UUID | null;
  transport_type_place_id: UUID | null;
  arrival_notes: string | null;
};

type Country = { id: UUID; name: string };
type TransportPlace = { id: UUID; name: string };

function supa() {
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return null;
}

const norm = (v?: string | null) => (v && v.trim() ? v.trim() : null);

function formatAddress(p: Pickup, countryName?: string) {
  return [
    norm(p.address1),
    norm(p.address2),
    norm(p.town),
    norm(p.region),
    norm(p.postal_code),
    norm(countryName),
  ]
    .filter(Boolean)
    .join(", ");
}

function publicImage(url?: string | null) {
  const raw = (url || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw;
  const host = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  const key = raw.replace(/^\/+/, "");
  const path = key.startsWith(`${bucket}/`) ? key : `${bucket}/${key}`;
  return `https://${host}/storage/v1/object/public/${path}`;
}

export default function PickupDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const sb = useMemo(() => supa(), []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [pickup, setPickup] = useState<Pickup | null>(null);
  const [country, setCountry] = useState<Country | null>(null);
  const [place, setPlace] = useState<TransportPlace | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) {
        setErr("Supabase not configured"); setLoading(false); return;
      }
      setLoading(true); setErr(null);
      try {
        const { data: p, error } = await sb.from("pickup_points").select("*").eq("id", id).maybeSingle();
        if (error) throw error;
        if (!p) throw new Error("Pick-up point not found");
        if (off) return;
        setPickup(p as Pickup);

        // lookups (country + place)
        const [cQ, ttpQ] = await Promise.all([
          p.country_id ? sb.from("countries").select("id,name").eq("id", p.country_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
          p.transport_type_place_id ? sb.from("transport_type_places").select("id,name").eq("id", p.transport_type_place_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);

        if (!off && cQ && (cQ as any).data) setCountry((cQ as any).data as Country);
        if (!off && ttpQ && (ttpQ as any).data) setPlace((ttpQ as any).data as TransportPlace);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [sb, id]);

  const img = publicImage(pickup?.picture_url);
  const address = pickup ? formatAddress(pickup, country?.name || undefined) : "";

  // Google Maps embed without API key, and a directions link
  const mapQuery = encodeURIComponent(address || pickup?.name || "");
  const mapsEmbed = `https://www.google.com/maps?q=${mapQuery}&output=embed`;
  const mapsDir = `https://www.google.com/maps/dir/?api=1&destination=${mapQuery}`;

  return (
    <div className="px-4 py-4 mx-auto w-full max-w-2xl">
      <button className="mb-3 px-3 py-1 rounded-lg border hover:bg-neutral-50" onClick={() => router.back()}>
        ← Back
      </button>
      <h1 className="text-2xl font-semibold">Pick-up Point</h1>

      {err && <div className="mt-3 p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

      {loading ? (
        <div className="mt-4 p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : pickup ? (
        <div className="mt-4 space-y-4">
          {/* Photo */}
          {img && (
            <div className="overflow-hidden rounded-2xl border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt={pickup.name} className="w-full max-h-[320px] object-cover" />
            </div>
          )}

          {/* Core info */}
          <div className="rounded-2xl border bg-white shadow p-4 space-y-2">
            <h2 className="text-xl font-medium">{pickup.name}</h2>
            {address && <p className="text-sm text-neutral-700">{address}</p>}
            {place?.name && (
              <div className="text-sm">
                <span className="font-medium">Place:</span> {place.name}
              </div>
            )}
            {pickup.description && (
              <div className="text-sm">
                <div className="font-medium mb-1">Description</div>
                <p className="whitespace-pre-wrap">{pickup.description}</p>
              </div>
            )}
            {pickup.arrival_notes && (
              <div className="text-sm">
                <div className="font-medium mb-1">Arrival notes</div>
                <p className="whitespace-pre-wrap">{pickup.arrival_notes}</p>
              </div>
            )}
          </div>

          {/* Map */}
          {address && (
            <div className="rounded-2xl border bg-white shadow overflow-hidden">
              <div className="aspect-[3/2] w-full">
                <iframe
                  title="Map"
                  src={mapsEmbed}
                  className="w-full h-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              </div>
              <div className="p-3">
                <a
                  href={mapsDir}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block px-4 py-2 rounded-lg text-white"
                  style={{ backgroundColor: "#2563eb" }}
                >
                  Open directions in Google Maps
                </a>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
