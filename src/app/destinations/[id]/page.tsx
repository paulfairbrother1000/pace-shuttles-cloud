"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type Destination = {
  id: UUID;
  country_id: UUID | null;
  name: string;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  phone: string | null;
  picture_url: string | null;
  description: string | null;
  season_from: string | null; // date
  season_to: string | null;   // date
  destination_type: string | null;
  url: string | null;
  gift: string | null;
  arrival_notes: string | null;
  email: string | null;
};

type Country = { id: UUID; name: string };

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

function toYMD(d?: string | null) {
  if (!d) return null;
  const dd = new Date(d);
  if (Number.isNaN(dd.getTime())) return null;
  return dd.toISOString().slice(0, 10);
}

function formatAddress(d: Destination, countryName?: string) {
  return [
    norm(d.address1),
    norm(d.address2),
    norm(d.town),
    norm(d.region),
    norm(d.postal_code),
    norm(countryName),
  ]
    .filter(Boolean)
    .join(", ");
}

export default function DestinationDetailsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params?.id as string;

  const sb = useMemo(() => supa(), []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [row, setRow] = useState<Destination | null>(null);
  const [country, setCountry] = useState<Country | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) { setErr("Supabase not configured"); setLoading(false); return; }
      setLoading(true); setErr(null);
      try {
        const { data, error } = await sb
          .from("destinations")
          .select(
            "id,country_id,name,address1,address2,town,region,postal_code,phone,picture_url,description,season_from,season_to,destination_type,url,gift,arrival_notes,email"
          )
          .eq("id", id)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error("Destination not found");
        if (off) return;

        setRow({
          ...(data as Destination),
          season_from: toYMD(data.season_from) || null,
          season_to: toYMD(data.season_to) || null,
          email: norm(data.email),
        });

        if (data.country_id) {
          const { data: c } = await sb.from("countries").select("id,name").eq("id", data.country_id).maybeSingle();
          if (!off && c) setCountry(c as Country);
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [sb, id]);

  const img = publicImage(row?.picture_url);
  const address = row ? formatAddress(row, country?.name || undefined) : "";
  const mapQuery = encodeURIComponent(address || row?.name || "");
  const mapsEmbed = `https://www.google.com/maps?q=${mapQuery}&output=embed`;
  const mapsDir = `https://www.google.com/maps/dir/?api=1&destination=${mapQuery}`;

  return (
    <div className="px-4 py-4 mx-auto w-full max-w-2xl">
      <button className="mb-3 px-3 py-1 rounded-lg border hover:bg-neutral-50" onClick={() => router.back()}>
        ← Back
      </button>
      <h1 className="text-2xl font-semibold">Destination</h1>

      {err && <div className="mt-3 p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

      {loading ? (
        <div className="mt-4 p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : row ? (
        <div className="mt-4 space-y-4">
          {img && (
            <div className="overflow-hidden rounded-2xl border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt={row.name} className="w-full max-h-[320px] object-cover" />
            </div>
          )}

          <div className="rounded-2xl border bg-white shadow p-4 space-y-2">
            <h2 className="text-xl font-medium">{row.name}</h2>
            {address && <p className="text-sm text-neutral-700">{address}</p>}

            <div className="grid grid-cols-1 gap-2 text-sm">
              {row.description && (
                <div>
                  <div className="font-medium mb-1">Description</div>
                  <p className="whitespace-pre-wrap">{row.description}</p>
                </div>
              )}

              {row.destination_type && (
                <div><span className="font-medium">Type:</span> {row.destination_type}</div>
              )}
              {row.url && (
                <div>
                  <span className="font-medium">Website:</span>{" "}
                  <a href={row.url} target="_blank" rel="noreferrer" className="text-blue-600 underline break-all">
                    {row.url}
                  </a>
                </div>
              )}
              {row.phone && (
                <div><span className="font-medium">Phone:</span> <a href={`tel:${row.phone}`} className="underline">{row.phone}</a></div>
              )}
              {row.email && (
                <div><span className="font-medium">Email:</span> <a href={`mailto:${row.email}`} className="underline break-all">{row.email}</a></div>
              )}
              {(row.season_from || row.season_to) && (
                <div>
                  <span className="font-medium">Season:</span>{" "}
                  {row.season_from || "—"} → {row.season_to || "—"}
                </div>
              )}
              {row.arrival_notes && (
                <div>
                  <div className="font-medium mb-1">Arrival notes</div>
                  <p className="whitespace-pre-wrap">{row.arrival_notes}</p>
                </div>
              )}
              {row.gift && (
                <div>
                  <div className="font-medium mb-1">Gift</div>
                  <p className="whitespace-pre-wrap">{row.gift}</p>
                </div>
              )}
            </div>
          </div>

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
