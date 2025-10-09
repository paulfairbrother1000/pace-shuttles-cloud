"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- types ---------- */
type UUID = string;
type PickupRow = {
  id: UUID;
  country_id: UUID;
  name: string;
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
type TransportType = { id: UUID; name: string };
type TransportPlace = { id: UUID; name: string };

/* ---------- supabase (browser) ---------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- image helper (no regex pitfalls) ---------- */
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;
  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === "localhost" || /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/.test(u.hostname);
      const publicPrefix = "/storage/v1/object/public/";
      if (u.pathname.startsWith(publicPrefix)) {
        const rest = u.pathname.slice(publicPrefix.length);
        return (isLocal || u.hostname !== supaHost)
          ? `https://${supaHost}${publicPrefix}${rest}?v=5`
          : `${raw}?v=5`;
      }
      return raw;
    } catch { return undefined; }
  }
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }
  const key = raw.replace(/^\/+/, "");
  const normalizedKey = key.startsWith(`${bucket}/`) ? key : `${bucket}/${key}`;
  return `https://${supaHost}/storage/v1/object/public/${normalizedKey}?v=5`;
}

/* ---------- tiny utils ---------- */
function addrLines(p: PickupRow, countryName?: string) {
  return [p.address1, p.address2, p.town, p.region, p.postal_code, countryName]
    .filter(Boolean)
    .map((s) => String(s));
}
function mapsEmbedUrl(lines: string[]) {
  const q = encodeURIComponent(lines.join(", "));
  // No API key needed for this generic “place search” embed
  return `https://www.google.com/maps?q=${q}&output=embed`;
}

export default function PickupDetailsPage({ params }: { params: { id: string }}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<PickupRow | null>(null);
  const [country, setCountry] = useState<Country | null>(null);
  const [type, setType] = useState<TransportType | null>(null);
  const [place, setPlace] = useState<TransportPlace | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (!sb) throw new Error("Supabase client not configured.");
        setLoading(true);
        setErr(null);

        const { data: p, error: pErr } = await sb.from("pickup_points").select("*").eq("id", params.id).maybeSingle();
        if (pErr) throw pErr;
        if (!p) throw new Error("Pick-up point not found.");
        if (off) return;

        setRow(p as PickupRow);

        // parallel fetches
        const [cQ, tQ, plQ] = await Promise.all([
          sb.from("countries").select("id,name").eq("id", p.country_id).maybeSingle(),
          p.transport_type_id ? sb.from("transport_types").select("id,name").eq("id", p.transport_type_id).maybeSingle() : Promise.resolve({ data: null as any, error: null }),
          p.transport_type_place_id ? sb.from("transport_type_places").select("id,name").eq("id", p.transport_type_place_id).maybeSingle() : Promise.resolve({ data: null as any, error: null }),
        ]);
        if (cQ.error) throw cQ.error;
        if (tQ.error) throw tQ.error;
        if (plQ.error) throw plQ.error;

        setCountry((cQ.data || null) as Country | null);
        setType((tQ.data || null) as TransportType | null);
        setPlace((plQ.data || null) as TransportPlace | null);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [params.id]);

  const photo = useMemo(() => publicImage(row?.picture_url) || "/placeholder.png", [row?.picture_url]);
  const lines = useMemo(() => addrLines(row as any, country?.name), [row, country?.name]);

  return (
    <div className="px-4 py-6 mx-auto max-w-3xl space-y-5">
      <button className="px-3 py-1 rounded-lg border hover:bg-neutral-50" onClick={() => router.back()}>← Back</button>
      <h1 className="text-2xl font-semibold">Pick-up</h1>

      {err && <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}
      {loading || !row ? (
        <div className="p-4 rounded-xl border bg-white">Loading…</div>
      ) : (
        <div className="rounded-2xl border bg-white shadow overflow-hidden">
          {/* Photo */}
          <div className="relative w-full aspect-[16/10] overflow-hidden border-b">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt={row.name} className="w-full h-full object-cover" />
          </div>

          {/* Body */}
          <div className="p-4 space-y-4">
            <div>
              <div className="text-xl font-semibold">{row.name}</div>
              {country?.name && <div className="text-sm text-neutral-600">{country.name}</div>}
            </div>

            {/* Address */}
            {lines.length > 0 && (
              <div className="text-sm">
                <div className="font-medium mb-1">Address</div>
                <div className="whitespace-pre-line leading-relaxed">
                  {lines.join("\n")}
                </div>
              </div>
            )}

            {/* Type (was “Place”) */}
            {(type?.name || place?.name) && (
              <div className="text-sm">
                <div className="font-medium mb-1">Type</div>
                <div>
                  {type?.name ?? "—"}
                  {place?.name ? ` · ${place.name}` : ""}
                </div>
              </div>
            )}

            {/* Description */}
            {row.description && (
              <div className="text-sm">
                <div className="font-medium mb-1">Description</div>
                <div className="whitespace-pre-line">{row.description}</div>
              </div>
            )}

            {/* Arrival notes (new) */}
            {row.arrival_notes && (
              <div className="text-sm">
                <div className="font-medium mb-1">Arrival notes</div>
                <div className="whitespace-pre-line">{row.arrival_notes}</div>
              </div>
            )}

            {/* Map */}
            {lines.length > 0 && (
              <div className="text-sm">
                <div className="font-medium mb-2">Location</div>
                <div className="aspect-[16/10] w-full overflow-hidden rounded-lg border">
                  <iframe
                    title="Map"
                    src={mapsEmbedUrl(lines)}
                    className="w-full h-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
                <div className="mt-1">
                  <a
                    className="text-blue-600 underline text-sm"
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lines.join(", "))}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Maps
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
