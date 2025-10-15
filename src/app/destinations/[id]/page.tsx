// src/app/destinations/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* =========================================================================================
   Pace Shuttles Theme (scoped to this page only)
   - Purely additive styling. No functionality removed.
   ========================================================================================= */
function Theme({ children }: { children: React.ReactNode }) {
  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      <style jsx global>{`
        .ps-theme {
          --bg:             #0f1a2a;  /* page background */
          --card:           #15243a;  /* tiles */
          --border:         #20334d;  /* subtle borders */
          --text:           #eaf2ff;  /* primary text */
          --muted:          #a3b3cc;  /* secondary text */
          --accent:         #2a6cd6;  /* links/buttons */
          --accent-contrast:#ffffff;  /* text on accent */
          --radius:         14px;
          --shadow:         0 6px 20px rgba(0,0,0,.25);

          color: var(--text);
          background: var(--bg);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        }
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

/* ---------- types ---------- */
type UUID = string;
type Destination = {
  id: UUID;
  country_id: UUID | null;
  name: string;
  picture_url: string | null;
  description: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  destination_type: string | null;
  phone: string | null;
  url: string | null;
  email: string | null;
  season_from: string | null; // YYYY-MM-DD
  season_to: string | null;   // YYYY-MM-DD
  arrival_notes: string | null;
  gift: string | null;
};
type Country = { id: UUID; name: string };

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

/* ---------- image helper ---------- */
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

/* ---------- utils ---------- */
function addrLines(d: Destination, countryName?: string) {
  return [d.address1, d.address2, d.town, d.region, d.postal_code, countryName]
    .filter(Boolean)
    .map((s) => String(s));
}
function fmtLocal(ymd: string | null) {
  if (!ymd) return null;
  try { return new Date(`${ymd}T12:00:00`).toLocaleDateString(); } catch { return ymd; }
}

export default function DestinationDetailsPage({ params }: { params: { id: string }}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [row, setRow] = useState<Destination | null>(null);
  const [country, setCountry] = useState<Country | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (!sb) throw new Error("Supabase client not configured.");
        setLoading(true);
        setErr(null);

        const { data: d, error } = await sb
          .from("destinations")
          .select("*")
          .eq("id", params.id)
          .maybeSingle();
        if (error) throw error;
        if (!d) throw new Error("Destination not found.");
        if (off) return;
        setRow(d as Destination);

        if (d.country_id) {
          const { data: c, error: cErr } = await sb
            .from("countries")
            .select("id,name")
            .eq("id", d.country_id)
            .maybeSingle();
          if (cErr) throw cErr;
          setCountry((c as any) || null);
        } else {
          setCountry(null);
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [params.id]);

  const photo = useMemo(() => publicImage(row?.picture_url) || "/placeholder.png", [row?.picture_url]);
  const lines = useMemo(() => (row ? addrLines(row, country?.name) : []), [row, country?.name]);

  const seasonFrom = fmtLocal(row?.season_from ?? null);
  const seasonTo   = fmtLocal(row?.season_to ?? null);

  /* --------------------------------- Render --------------------------------- */
  return (
    <Theme>
      <div className="px-4 py-6 mx-auto max-w-3xl space-y-5">
        <div className="flex items-center gap-3">
          <button className="pill" onClick={() => router.back()}>← Back</button>
          <h1 className="text-2xl font-semibold">Destination</h1>
        </div>

        {err && (
          <div
            className="p-3 rounded-lg tile-border text-sm"
            style={{ background: "rgba(244,63,94,.15)", color: "#ffb4c1" }}
          >
            {err}
          </div>
        )}

        {loading || !row ? (
          <div className="tile tile-border p-4">Loading…</div>
        ) : (
          <div className="tile tile-border overflow-hidden">
            {/* Photo */}
            <div className="relative w-full aspect-[16/10] overflow-hidden" style={{ borderBottom: "1px solid var(--border)" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo} alt={row.name} className="w-full h-full object-cover" />
            </div>

            {/* Body */}
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xl font-semibold">{row.name}</div>
                {country?.name && <div className="text-sm text-muted">{country.name}</div>}
              </div>

              {/* Address */}
              {lines.length > 0 && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Address</div>
                  <div className="whitespace-pre-line leading-relaxed text-muted">{lines.join("\n")}</div>
                </div>
              )}

              {/* Description */}
              {row.description && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Description</div>
                  <div className="whitespace-pre-line text-muted">{row.description}</div>
                </div>
              )}

              {/* Destination type */}
              {row.destination_type && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Destination type</div>
                  <div className="text-muted">{row.destination_type}</div>
                </div>
              )}

              {/* Contact */}
              {(row.url || row.phone || row.email) && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Contact</div>
                  <div className="space-y-0.5 text-muted">
                    {row.url && (
                      <div>
                        Website:{" "}
                        <a className="underline break-all" href={row.url} target="_blank" rel="noreferrer">
                          {row.url}
                        </a>
                      </div>
                    )}
                    {row.phone && <div>Phone: {row.phone}</div>}
                    {row.email && <div>Email: {row.email}</div>}
                  </div>
                </div>
              )}

              {/* Season */}
              {(seasonFrom || seasonTo) && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Season</div>
                  <div className="text-muted">{seasonFrom ?? "—"} → {seasonTo ?? "—"}</div>
                </div>
              )}

              {/* Arrival notes */}
              {row.arrival_notes && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Arrival notes</div>
                  <div className="whitespace-pre-line text-muted">{row.arrival_notes}</div>
                </div>
              )}

              {/* Gift */}
              {row.gift && (
                <div className="text-sm">
                  <div className="font-medium mb-1">Gift for Pace Shuttles’ Guests</div>
                  <div className="whitespace-pre-line text-muted">{row.gift}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Theme>
  );
}
