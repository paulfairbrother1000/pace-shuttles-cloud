"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* =========================================================================================
   Pace Shuttles – Create Destination (New)
   - Fixes 22P02 by sending NULL to uuid columns instead of "".
   - Keeps both "Picture URL" and file upload; upload takes precedence if provided.
   - Dark brand theme is scoped to this page only (styled-jsx in a Client Component).
   ========================================================================================= */

/* ---------- Supabase (browser) ---------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- Types ---------- */
type UUID = string;
type Country = { id: UUID; name: string };

/* ---------- Helpers ---------- */
const nullIfEmpty = <T extends string | null | undefined>(v: T) =>
  typeof v === "string" && v.trim() === "" ? null : v ?? null;

const ymdOrNull = (v?: string | null) => {
  const s = (v ?? "").trim();
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

function livePreviewUrl(url?: string | null) {
  const raw = (url || "").trim();
  if (!raw) return "/placeholder.png";
  try {
    // If it looks like a Supabase public path, normalise host
    const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
    const supaHost = supaUrl.replace(/^https?:\/\//i, "");
    const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
    if (!/^https?:\/\//i.test(raw)) {
      const key = raw.replace(/^\/+/, "");
      const k2 = key.startsWith(`${bucket}/`) ? key : `${bucket}/${key}`;
      return `https://${supaHost}/storage/v1/object/public/${k2}?v=5`;
    }
    const u = new URL(raw);
    if (/^\/storage\/v1\/object\/public\//.test(u.pathname)) {
      const rest = u.pathname.replace(/^\/storage\/v1\/object\/public\//, "");
      return `https://${supaHost}/storage/v1/object/public/${rest}?v=5`;
    }
    return raw;
  } catch {
    return "/placeholder.png";
  }
}

/* ---------- Page ---------- */
export default function NewDestinationPage() {
  const router = useRouter();

  // Form state
  const [name, setName] = useState("");
  const [countryId, setCountryId] = useState<string | null>(null);
  const [pictureUrl, setPictureUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [destinationType, setDestinationType] = useState<string>("");
  const [wetOrDry, setWetOrDry] = useState<string>("wet"); // default to "wet" like your UI copy
  const [website, setWebsite] = useState("");
  const [email, setEmail] = useState("");

  // Optional extras seen elsewhere on the model
  const [description, setDescription] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [town, setTown] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [seasonFrom, setSeasonFrom] = useState<string>("");
  const [seasonTo, setSeasonTo] = useState<string>("");
  const [arrivalNotes, setArrivalNotes] = useState("");
  const [gift, setGift] = useState("");

  // Lists
  const [countries, setCountries] = useState<Country[]>([]);

  // UX
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  /* ----- Load countries for the select ----- */
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (!sb) throw new Error("Supabase not configured");
        const { data, error } = await sb
          .from("countries")
          .select("id,name")
          .order("name", { ascending: true });
        if (error) throw error;
        if (!off) setCountries((data as Country[]) || []);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? "Failed to load countries");
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  /* ----- Preview image (URL or uploaded file) ----- */
  const preview = useMemo(() => {
    if (file) {
      try {
        return URL.createObjectURL(file);
      } catch {
        /* ignore */
      }
    }
    return livePreviewUrl(pictureUrl);
  }, [file, pictureUrl]);

  /* ----- Upload image to public bucket if a file was selected ----- */
  async function uploadIfNeeded(): Promise<string | null> {
    if (!file) return nullIfEmpty(pictureUrl);
    if (!sb) throw new Error("Supabase not configured");

    // Generate a key: images/destinations/<timestamp>-<sanitised-name>.<ext>
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const safeName = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const key = `images/destinations/${Date.now()}-${safeName || "destination"}.${ext}`;

    const { error } = await sb.storage.from("images").upload(key, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) throw error;

    // Public URL
    const { data: pub } = sb.storage.from("images").getPublicUrl(key);
    return pub?.publicUrl ?? key; // store either full URL or path – your normaliser handles both
  }

  /* ----- Submit ----- */
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setOkMsg(null);

    if (!sb) {
      setErr("Supabase not configured.");
      return;
    }
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }

    setLoading(true);
    try {
      // Picture: if file selected, upload and use that; else use provided URL or null
      const pic = await uploadIfNeeded();

      // IMPORTANT: normalise blanks to NULL for uuid/text/date fields
      const payload: Record<string, any> = {
        name: name.trim(),
        country_id: nullIfEmpty(countryId), // <- critical to avoid 22P02
        picture_url: nullIfEmpty(pic),
        description: nullIfEmpty(description),
        address1: nullIfEmpty(address1),
        address2: nullIfEmpty(address2),
        town: nullIfEmpty(town),
        region: nullIfEmpty(region),
        postal_code: nullIfEmpty(postal),
        destination_type: nullIfEmpty(destinationType),
        phone: null, // (not in this form – leave null to avoid overwriting server defaults)
        url: nullIfEmpty(website),
        email: nullIfEmpty(email),
        season_from: ymdOrNull(seasonFrom),
        season_to: ymdOrNull(seasonTo),
        arrival_notes: nullIfEmpty(arrivalNotes),
        gift: nullIfEmpty(gift),

        // if your schema uses a separate column for wet/dry, include it here:
        wet_or_dry: nullIfEmpty(wetOrDry),
      };

      // Remove undefined keys (keep nulls)
      Object.keys(payload).forEach((k) => {
        if (payload[k] === undefined) delete (payload as any)[k];
      });

      const { data, error } = await sb.from("destinations").insert(payload).select("id").single();
      if (error) throw error;

      setOkMsg("Destination created.");
      // Navigate to detail page if you want
      if (data?.id) router.replace(`/destinations/${data.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to save destination.");
    } finally {
      setLoading(false);
    }
  }

  /* --------------------------------- Render --------------------------------- */
  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      {/* Scoped branding */}
      <style jsx global>{`
        .ps-theme{
          --bg:#0f1a2a;
          --card:#15243a;
          --border:#20334d;
          --text:#eaf2ff;
          --muted:#a3b3cc;
          --accent:#2a6cd6;
          --accent-contrast:#ffffff;
          --radius:14px;
          --shadow:0 6px 20px rgba(0,0,0,.25);
        }
        .bg-app{background:var(--bg);}
        .text-app{color:var(--text);}
        .tile{background:var(--card); border-radius:var(--radius); box-shadow:var(--shadow);}
        .tile-border{box-shadow:0 0 0 1px var(--border) inset;}
        .pill{border-radius:9999px; padding:.45rem .8rem; border:1px solid var(--border); background:transparent; color:var(--text);}
        .pill:hover{background:rgba(255,255,255,.06);}
        .label{font-size:.85rem; color:var(--muted);}
        .input, .select, .textarea{
          width:100%; background:transparent; color:var(--text);
          border:1px solid var(--border); border-radius:.75rem; padding:.6rem .8rem;
        }
        .textarea{min-height:90px; resize:vertical;}
        .hint{font-size:.75rem; color:var(--muted);}
        .btn-primary{
          border-radius:.9rem; background:var(--accent); color:var(--accent-contrast);
          padding:.65rem 1.1rem; border:0;
        }
        a { color:var(--text); text-decoration:none; }
        a:hover{ color:var(--accent); }
      `}</style>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-5">
        <div className="flex items-center gap-3">
          <button className="pill" onClick={() => router.back()}>← Back</button>
          <h1 className="text-2xl font-semibold">New Destination</h1>
        </div>

        {/* Error / OK banners */}
        {err && (
          <div className="tile tile-border p-3" style={{ background: "rgba(244,63,94,.15)", color: "#ffb4c1" }}>
            {err}
          </div>
        )}
        {okMsg && (
          <div className="tile tile-border p-3" style={{ background: "rgba(34,197,94,.15)", color: "#b6f3c7" }}>
            {okMsg}
          </div>
        )}

        <form onSubmit={onSubmit} className="tile tile-border p-4 space-y-5">
          {/* Row: name + picture url */}
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <div className="label">Name</div>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label className="block">
              <div className="label">Picture URL (optional)</div>
              <input
                className="input"
                placeholder="https://… (or leave blank and upload a file below)"
                value={pictureUrl}
                onChange={(e) => setPictureUrl(e.target.value)}
              />
            </label>
          </div>

          {/* Row: country + file upload (with preview) */}
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <div className="label">Country</div>
              <select
                className="select"
                value={countryId ?? ""}
                onChange={(e) => setCountryId(e.target.value || null)}
              >
                <option value="">— Select —</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="label">Upload image</div>
              <input
                className="input"
                type="file"
                accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <div className="hint">If a file is chosen, it will replace the URL above on save.</div>
            </label>
          </div>

          {/* Image preview */}
          <div className="w-full overflow-hidden rounded-xl tile-border" style={{ borderRadius: "12px" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="preview" className="w-full h-56 object-cover" />
          </div>

          {/* Row: destination type + wet/dry */}
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <div className="label">Destination Type</div>
              <input
                className="input"
                placeholder="e.g. Restaurant, Beach, Bar…"
                value={destinationType}
                onChange={(e) => setDestinationType(e.target.value)}
              />
            </label>

            <label className="block">
              <div className="label">Arrival Type</div>
              <select className="select" value={wetOrDry} onChange={(e) => setWetOrDry(e.target.value)}>
                <option value="wet">Wet</option>
                <option value="dry">Dry</option>
              </select>
              <div className="hint">Current wet/dry value: <strong>{wetOrDry || "—"}</strong></div>
            </label>
          </div>

          {/* Website + email */}
          <div className="grid md:grid-cols-2 gap-4">
            <label className="block">
              <div className="label">Website URL</div>
              <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
            <label className="block">
              <div className="label">Destination contact email</div>
              <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </div>

          {/* Optional extra content (already in model) */}
          <details className="tile tile-border p-3">
            <summary className="cursor-pointer">More details</summary>
            <div className="mt-3 grid md:grid-cols-2 gap-4">
              <label className="block">
                <div className="label">Address 1</div>
                <input className="input" value={address1} onChange={(e) => setAddress1(e.target.value)} />
              </label>
              <label className="block">
                <div className="label">Address 2</div>
                <input className="input" value={address2} onChange={(e) => setAddress2(e.target.value)} />
              </label>
              <label className="block">
                <div className="label">Town</div>
                <input className="input" value={town} onChange={(e) => setTown(e.target.value)} />
              </label>
              <label className="block">
                <div className="label">Region</div>
                <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
              </label>
              <label className="block">
                <div className="label">Postal code</div>
                <input className="input" value={postal} onChange={(e) => setPostal(e.target.value)} />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="label">Season from (YYYY-MM-DD)</div>
                  <input className="input" value={seasonFrom} onChange={(e) => setSeasonFrom(e.target.value)} />
                </label>
                <label className="block">
                  <div className="label">Season to (YYYY-MM-DD)</div>
                  <input className="input" value={seasonTo} onChange={(e) => setSeasonTo(e.target.value)} />
                </label>
              </div>
              <label className="block md:col-span-2">
                <div className="label">Description</div>
                <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
              </label>
              <label className="block md:col-span-2">
                <div className="label">Arrival notes</div>
                <textarea className="textarea" value={arrivalNotes} onChange={(e) => setArrivalNotes(e.target.value)} />
              </label>
              <label className="block md:col-span-2">
                <div className="label">Gift for Pace Shuttles’ Guests</div>
                <textarea className="textarea" value={gift} onChange={(e) => setGift(e.target.value)} />
              </label>
            </div>
          </details>

          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? "Saving…" : "Save destination"}
            </button>
            <button type="button" className="pill" onClick={() => router.back()} disabled={loading}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
