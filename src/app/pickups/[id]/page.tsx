// src/app/pickups/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* =========================================================================================
   Pace Shuttles Theme (scoped to this page only)
   - Uses the same variables as the home/admin work so tiles/fonts match across pages.
   - No functionality removed; this is purely presentational + additive CSS.
   ========================================================================================= */
function Theme({ children }: { children: React.ReactNode }) {
  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      <style jsx global>{`
        .ps-theme {
          --bg:             #0f1a2a;
          --card:           #15243a;
          --border:         #20334d;
          --text:           #eaf2ff;
          --muted:          #a3b3cc;
          --accent:         #2a6cd6;
          --accent-contrast:#ffffff;
          --radius:         14px;
          --shadow:         0 6px 20px rgba(0,0,0,.25);

          color: var(--text);
          background: var(--bg);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        }

        /* helpers reused across the app */
        .bg-app   { background: var(--bg); }
        .bg-card  { background: var(--card); }
        .text-app { color: var(--text); }
        .text-muted { color: var(--muted); }
        .tile { background: var(--card); border-radius: var(--radius); box-shadow: var(--shadow); }
        .tile-border { box-shadow: 0 0 0 1px var(--border) inset; }
        .subtle-border { box-shadow: 0 0 0 1px var(--border) inset; }

        .pill { border-radius: 9999px; padding: .4rem .75rem; font-size: .875rem; border: 1px solid var(--border); background: transparent; color: var(--text); }
        .pill:hover { background: rgba(255,255,255,.06); }
        .btn { border-radius: var(--radius); padding: .6rem .9rem; border: 1px solid var(--border); background: var(--card); color: var(--text); }
        .btn:hover { filter: brightness(1.05); }
        a { color: var(--text); text-decoration: none; }
        a:hover { color: var(--accent); }
      `}</style>
      {children}
    </div>
  );
}

// Simple public image normalizer (same behaviour as other screens)
function publicImage(input?: string | null): string {
  const raw = (input || "").trim();
  if (!raw) return "/placeholder.png";

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return raw;

  // absolute
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) return `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`;
      return raw;
    } catch {
      return "/placeholder.png";
    }
  }

  // relative to public storage
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }

  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) {
    return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  }
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
}

type UUID = string;

// Minimal shapes
type Country = { id: UUID; name: string };
type TransportType = { id: UUID; name: string };
type TransportPlace = { id: UUID; transport_type_id: UUID; name: string };

type PickupRow = {
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

export default function PickupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const sb = useMemo(() => {
    if (typeof window === "undefined") return null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createBrowserClient(url, anon) : null;
  }, []);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [row, setRow] = useState<PickupRow | null>(null);
  const [country, setCountry] = useState<Country | null>(null);
  const [tType, setTType] = useState<TransportType | null>(null);
  const [tPlace, setTPlace] = useState<TransportPlace | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const { data: p, error: pErr } = await sb
          .from("pickup_points")
          .select("*")
          .eq("id", id)
          .maybeSingle();
        if (pErr) throw pErr;
        if (!p) throw new Error("Pick-up not found.");

        if (off) return;
        setRow(p as PickupRow);

        // Fetch lookups in parallel (guard nulls)
        const promises: Promise<any>[] = [];
        if (p.country_id) {
          promises.push(
            sb.from("countries").select("id,name").eq("id", p.country_id).maybeSingle()
          );
        } else promises.push(Promise.resolve({ data: null, error: null }));

        if (p.transport_type_id) {
          promises.push(
            sb.from("transport_types").select("id,name").eq("id", p.transport_type_id).maybeSingle()
          );
        } else promises.push(Promise.resolve({ data: null, error: null }));

        if (p.transport_type_place_id) {
          promises.push(
            sb
              .from("transport_type_places")
              .select("id,transport_type_id,name")
              .eq("id", p.transport_type_place_id)
              .maybeSingle()
          );
        } else promises.push(Promise.resolve({ data: null, error: null }));

        const [cQ, tQ, tpQ] = await Promise.all(promises);
        if (!off) {
          if (cQ?.error) throw cQ.error;
          if (tQ?.error) throw tQ.error;
          if (tpQ?.error) throw tpQ.error;
          setCountry((cQ?.data as Country) ?? null);
          setTType((tQ?.data as TransportType) ?? null);
          setTPlace((tpQ?.data as TransportPlace) ?? null);
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [sb, id]);

  const imgSrc = publicImage(row?.picture_url);

  // Compose a best-effort single-line address for map search
  const addressLine = [
    row?.address1, row?.address2, row?.town, row?.region, row?.postal_code, country?.name,
  ].filter(Boolean).join(", ");

  // Google Maps "search" embed (no API key). If no address/name, hide the map.
  const mapsQuery = encodeURIComponent([row?.name, addressLine].filter(Boolean).join(" - "));
  const mapsEmbedSrc = mapsQuery
    ? `https://www.google.com/maps?q=${mapsQuery}&output=embed`
    : null;
  const mapsOpenHref = mapsQuery
    ? `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`
    : null;

  /* ---------------------------------------------------------------------------------------
     RENDER (same sections as before; swapped classes to match ps-theme, but functionality,
     structure, state, and conditional logic are unchanged).
     --------------------------------------------------------------------------------------- */
  return (
    <Theme>
      <div className="px-4 py-6 mx-auto max-w-3xl space-y-5">
        <header className="flex items-center gap-3">
          {/* Back button: keep behaviour, restyle to pill (dark theme) */}
          <button
            className="pill"
            onClick={() => router.back()}
          >
            ← Back
          </button>
          <h1 className="text-2xl font-semibold">Pick-up</h1>
        </header>

        {err && (
          // Same error content, themed container (keeps copy and logic intact)
          <div
            className="p-3 rounded-lg tile-border text-sm"
            style={{ background: "rgba(244,63,94,.15)", color: "#ffb4c1" }}
          >
            {err}
          </div>
        )}

        {loading ? (
          <div className="tile tile-border p-4">Loading…</div>
        ) : !row ? (
          <div className="tile tile-border p-4">Not found.</div>
        ) : (
          <div className="tile tile-border overflow-hidden">
            {/* Photo */}
            <div className="relative w-full overflow-hidden" style={{ borderBottom: "1px solid var(--border)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imgSrc}
                alt={row.name}
                className="w-full h-64 object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = "/placeholder.png";
                }}
              />
            </div>

            <div className="p-4 space-y-4">
              {/* Title & Type */}
              <div>
                <div className="text-xl font-semibold">{row.name}</div>
                <div className="text-sm text-muted">
                  <span className="font-medium">Type:</span>{" "}
                  {tPlace?.name || tType?.name || "—"}
                </div>
              </div>

              {/* Address */}
              <div className="text-sm">
                <div className="font-medium">Address</div>
                <div className="text-muted">
                  {[row.address1, row.address2].filter(Boolean).map((l, i) => (
                    <div key={i}>{l}</div>
                  ))}
                  <div>
                    {[row.town, row.region, row.postal_code].filter(Boolean).join(", ")}
                  </div>
                  {country?.name && <div>{country.name}</div>}
                </div>
              </div>

              {/* Description */}
              {row.description && (
                <div className="text-sm">
                  <div className="font-medium">Description</div>
                  <div className="whitespace-pre-wrap text-muted">
                    {row.description}
                  </div>
                </div>
              )}

              {/* Arrival notes */}
              {row.arrival_notes && (
                <div className="text-sm">
                  <div className="font-medium">Arrival notes</div>
                  <div className="whitespace-pre-wrap text-muted">
                    {row.arrival_notes}
                  </div>
                </div>
              )}

              {/* Map */}
              {mapsEmbedSrc && (
                <div className="space-y-2">
                  <div className="font-medium text-sm">Location</div>
                  <div className="w-full overflow-hidden rounded-lg subtle-border">
                    <iframe
                      title="map"
                      src={mapsEmbedSrc}
                      style={{ border: 0, width: "100%", height: 320 }}
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  </div>
                  {mapsOpenHref && (
                    <a
                      href={mapsOpenHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block text-sm underline"
                    >
                      Open in Google Maps
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Theme>
  );
}
