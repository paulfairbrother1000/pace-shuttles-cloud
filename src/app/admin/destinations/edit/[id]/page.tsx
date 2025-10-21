"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

// --- DB shapes (only what we read/write) ---
type Country = { id: UUID; name: string };
type DestinationRow = {
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
  season_from: string | null; // YYYY-MM-DD
  season_to: string | null;   // YYYY-MM-DD
  destination_type: string | null;
  wet_or_dry: "wet" | "dry" | null;
  url: string | null;
  gift: string | null;
  arrival_notes: string | null;
  email: string | null;
};

type DestType = { id: number; type: string | null };

// ---- Storage config for uploads ----
const BUCKET = "images";
const FOLDER = "destinations";

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

function slugify(str: string) {
  return (str || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** empty → null; trims strings */
const norm = (val: string | null | undefined) => {
  const t = (val ?? "").trim();
  return t.length ? t : null;
};

function emptyDest(): DestinationRow {
  return {
    id: "" as UUID,
    country_id: null,
    name: "",
    address1: "",
    address2: "",
    town: "",
    region: "",
    postal_code: "",
    phone: "",
    picture_url: "",
    description: "",
    season_from: null,
    season_to: null,
    destination_type: "Restaurant",
    wet_or_dry: "dry",
    url: "",
    gift: "",
    arrival_notes: "",
    email: null, // important: start as null
  };
}

/** Turn a storage key or partial path into a full public image URL. */
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;

  // already absolute
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) return `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`;
      return raw;
    } catch {
      return undefined;
    }
  }
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }
  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) {
    return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  }
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
}

function toYMD(d: string | Date | null | undefined) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function DestinationEditPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isCreate = params.id === "new";

  const client = useMemo(() => supa(), []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [countries, setCountries] = useState<Country[]>([]);
  const [destTypes, setDestTypes] = useState<DestType[]>([]);

  const [row, setRow] = useState<DestinationRow>(() => emptyDest());

  // Image upload state
  const [file, setFile] = useState<File | null>(null);
  const imgSrc = useMemo(
    () => (file ? URL.createObjectURL(file) : publicImage(row?.picture_url || "") || ""),
    [file, row?.picture_url]
  );

  // Preload lookups + (optionally) existing row
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!client) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const [cQ, dtQ] = await Promise.all([
          client.from("countries").select("id,name").order("name", { ascending: true }),
          client.from("destination_type").select("id,type").order("id", { ascending: true }),
        ]);
        if (cQ.error) throw cQ.error;
        if (dtQ.error) throw dtQ.error;

        if (cancelled) return;
        setCountries((cQ.data || []) as Country[]);
        setDestTypes((dtQ.data || []) as DestType[]);

        if (!isCreate) {
          const { data, error } = await client
            .from("destinations")
            .select(
              [
                "id",
                "country_id",
                "name",
                "address1",
                "address2",
                "town",
                "region",
                "postal_code",
                "phone",
                "picture_url",
                "description",
                "season_from",
                "season_to",
                "destination_type",
                "wet_or_dry",
                "url",
                "gift",
                "arrival_notes",
                "email",
              ].join(",")
            )
            .eq("id", params.id)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("Destination not found.");
          const r = data as DestinationRow;

          // Coerce legacy wet/dry
          const legacy = (r.wet_or_dry ?? "").toString().toLowerCase();
          const coercedWD: "wet" | "dry" | null =
            legacy === "wet" ? "wet" : legacy === "dry" ? "dry" : null;

          // Robust email blank → null
          const rawEmail =
            r.email === null ? null : (typeof r.email === "string" ? r.email : String(r.email));
          const trimmedEmail = rawEmail === null ? null : rawEmail.trim();
          const cleanEmail = trimmedEmail && trimmedEmail.length > 0 ? trimmedEmail : null;

          setRow({
            ...r,
            wet_or_dry: coercedWD,
            email: cleanEmail,
            season_from: r.season_from ? toYMD(r.season_from) : null,
            season_to: r.season_to ? toYMD(r.season_to) : null,
          });
        } else {
          setRow(emptyDest());
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, isCreate, params.id]);

  function update<K extends keyof DestinationRow>(key: K, v: DestinationRow[K]) {
    setRow((r) => ({ ...r, [key]: v }));
  }

  async function handleSave() {
    if (!client) return;
    setErr(null);
    try {
      // strong normalize email
      const normalizedEmail = norm(row.email);

      // optional image upload (file wins over URL)
      let picture_url: string | null = norm(row.picture_url);
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const key = `${FOLDER}/${slugify(row.name || "destination")}.${ext}`;
        const { error: upErr } = await client.storage
          .from(BUCKET)
          .upload(key, file, {
            upsert: true,
            cacheControl: "3600",
            contentType:
              file.type || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg"),
          });
        if (upErr) throw upErr;
        const { data: pub } = client.storage.from(BUCKET).getPublicUrl(key);
        picture_url = pub?.publicUrl || picture_url;
      }

      // normalize wet/dry strictly
      const wd = (row.wet_or_dry ?? "").toString().toLowerCase();
      const wet_or_dry: "wet" | "dry" | null = wd === "wet" ? "wet" : wd === "dry" ? "dry" : null;

      // ----- FIX: build payload WITHOUT id so we never send id: "" on create -----
      // Destructure id out of the row so it doesn't get sent.
      const { id: _omit, ...rest } = row;

      const payload: any = {
        ...rest, // no id here
        name: String(row.name || "").trim(),
        season_from: row.season_from ? toYMD(row.season_from) : null,
        season_to: row.season_to ? toYMD(row.season_to) : null,
        destination_type: norm(row.destination_type) as any,
        wet_or_dry,
        url: norm(row.url),
        gift: norm(row.gift),
        phone: norm(row.phone),
        address1: norm(row.address1),
        address2: norm(row.address2),
        town: norm(row.town),
        region: norm(row.region),
        postal_code: norm(row.postal_code),
        description: norm(row.description),
        picture_url,
        arrival_notes: norm(row.arrival_notes),
        country_id: row.country_id ?? null, // ensure null (not "")
      };

      // Only include email if present (leave column untouched when null)
      if (normalizedEmail) payload.email = normalizedEmail;
      else payload.email = null;

      // quick client validation
      if (payload.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email)) {
        setErr("Please enter a valid email or leave it blank.");
        return;
      }

      if (isCreate) {
        // INSERT without id key prevents 22P02 on uuid columns
        const { error } = await client.from("destinations").insert(payload);
        if (error) throw error;
      } else {
        // UPDATE by id is fine; still don't send id in body
        const { error } = await client.from("destinations").update(payload).eq("id", params.id);
        if (error) throw error;
      }

      router.push("/admin/destinations");
    } catch (e: any) {
      // surface the exact error to the banner
      setErr(e?.message ?? String(e));
      // and log the full error to the console for stack/location
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  return (
    <div className="px-4 py-6 mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-3">
        <button
          className="px-3 py-1 rounded-lg border hover:bg-neutral-50"
          onClick={() => router.back()}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">
          {isCreate ? "New Destination" : "Edit Destination"}
        </h1>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden">
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Basic / ownership */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Name</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Loose Canon"
                />
              </label>

              <label className="block text-sm">
                <span className="text-neutral-700">Country</span>
                <select
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.country_id ?? ""}
                  onChange={(e) => update("country_id", (e.target.value || null) as UUID | null)}
                >
                  <option value="">—</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="text-neutral-700">Destination Type</span>
                <select
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.destination_type ?? ""}
                  onChange={(e) => update("destination_type", e.target.value || null)}
                >
                  {destTypes.length === 0 ? (
                    <>
                      {["Restaurant", "Bar", "Beach Club", "Restaurant & Bar"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </>
                  ) : (
                    destTypes.map((t) => (
                      <option key={t.id} value={t.type ?? ""}>
                        {t.type ?? ""}
                      </option>
                    ))
                  )}
                </select>
              </label>

              {/* Simple Wet/Dry select */}
              <label className="block text-sm">
                <span className="text-neutral-700">Arrival Type</span>
                <select
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.wet_or_dry ?? ""}
                  onChange={(e) => {
                    const v = (e.target.value || "").toLowerCase();
                    update("wet_or_dry", (v === "wet" ? "wet" : v === "dry" ? "dry" : null) as any);
                  }}
                >
                  <option value="">—</option>
                  <option value="wet">Wet</option>
                  <option value="dry">Dry</option>
                </select>
                <div className="mt-1 text-xs text-neutral-600">
                  Current wet/dry value: <strong>{row.wet_or_dry ?? "—"}</strong>
                </div>
              </label>
            </div>

            {/* Image + URL + Upload */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Picture URL (optional)</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.picture_url ?? ""}
                  onChange={(e) => {
                    setFile(null);
                    update("picture_url", e.target.value || null);
                  }}
                  placeholder="https://… (or leave blank and upload a file below)"
                />
              </label>

              <label className="block text-sm">
                <span className="text-neutral-700">Upload image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                  }}
                />
                <div className="text-xs text-neutral-500 mt-1">
                  If a file is chosen, it will replace the URL above on save.
                </div>
              </label>

              <div className="relative w-full overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imgSrc}
                  alt={row.name || "Destination image"}
                  className="w-full h-48 object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                  }}
                />
              </div>

              <label className="block text-sm">
                <span className="text-neutral-700">Website URL</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.url ?? ""}
                  onChange={(e) => update("url", e.target.value || null)}
                  placeholder="https://example.com"
                  onBlur={(e) => update("url", norm(e.target.value))}
                />
              </label>

              <label className="block text-sm">
                <span className="text-neutral-700">Destination contact email</span>
                <input
                  type="email"
                  inputMode="email"
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.email ?? ""}
                  onChange={(e) => update("email", e.target.value)}
                  onBlur={(e) => update("email", norm(e.target.value))}
                  placeholder="destinations@operator.com"
                />
              </label>
            </div>

            {/* Address */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Address line 1</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.address1 ?? ""}
                  onChange={(e) => update("address1", e.target.value || null)}
                />
              </label>
              <label className="block text-sm">
                <span className="text-neutral-700">Address line 2</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.address2 ?? ""}
                  onChange={(e) => update("address2", e.target.value || null)}
                />
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <label className="block text-sm">
                  <span className="text-neutral-700">Town</span>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.town ?? ""}
                    onChange={(e) => update("town", e.target.value || null)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-neutral-700">Region</span>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.region ?? ""}
                    onChange={(e) => update("region", e.target.value || null)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-neutral-700">Postal code</span>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.postal_code ?? ""}
                    onChange={(e) => update("postal_code", e.target.value || null)}
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-neutral-700">Phone</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.phone ?? ""}
                  onChange={(e) => update("phone", e.target.value || null)}
                  placeholder="+1 268 …"
                />
              </label>
            </div>

            {/* Description + seasons + gift */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Description</span>
                <textarea
                  className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[120px]"
                  value={row.description ?? ""}
                  onChange={(e) => update("description", e.target.value || null)}
                />
              </label>

              <label className="block text-sm">
                <span className="text-neutral-700">Arrival notes (shown to passengers)</span>
                <textarea
                  className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[100px]"
                  value={row.arrival_notes ?? ""}
                  onChange={(e) => update("arrival_notes", e.target.value || null)}
                  placeholder="e.g., Disembark at Dock B, follow the blue signs to the main gate."
                />
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="text-neutral-700">Season from</span>
                  <input
                    type="date"
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.season_from ?? ""}
                    onChange={(e) => update("season_from", e.target.value || null)}
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-neutral-700">Season to</span>
                  <input
                    type="date"
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.season_to ?? ""}
                    onChange={(e) => update("season_to", e.target.value || null)}
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="text-neutral-700">Gift</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.gift ?? ""}
                  onChange={(e) => update("gift", e.target.value || null)}
                  placeholder="e.g., welcome drink"
                />
              </label>
            </div>
          </div>

          <div className="p-4 border-t flex items-center gap-2 justify-end">
            <button
              className="px-4 py-2 rounded-lg border hover:bg-neutral-50"
              onClick={() => router.back()}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: "#2563eb" }}
              onClick={handleSave}
            >
              {isCreate ? "Create Destination" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
