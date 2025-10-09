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
  destination_type: string | null; // constrained check
  wet_or_dry: "wet" | "dry" | null;
  url: string | null;
  gift: string | null;
  // NEW FIELDS
  arrival_notes: string | null;
  email: string | null;
};

type DestType = { id: number; type: string | null };
type ArrivalType = { id: number; type: "wet" | "dry" | null; advice: string | null };

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
    // NEW defaults
    arrival_notes: "",
    email: "",
  };
}

/** Turn a storage key or partial path into a full public image URL. */
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  // add near the top of the file
const norm = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};


  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;

  // already absolute
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      // unify public object path with cache-busting param
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) {
        const full = `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`;
        return full;
      }
      return raw;
    } catch {
      return undefined;
    }
  }

  // stored as /storage/v1/object/public/...
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }

  // stored as "images/foo.jpg" or "bucket/foo.jpg" or just "foo.jpg"
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

export default function DestinationEditPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const isCreate = params.id === "new";

  const client = useMemo(() => supa(), []);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [countries, setCountries] = useState<Country[]>([]);
  const [destTypes, setDestTypes] = useState<DestType[]>([]);
  const [arrivalTypes, setArrivalTypes] = useState<ArrivalType[]>([]);

  const [row, setRow] = useState<DestinationRow>(() => emptyDest());
  const [arrivalChoice, setArrivalChoice] = useState<number | null>(null); // destination_arrival.id
  const selectedArrival = arrivalTypes.find((a) => a.id === arrivalChoice);

  // derived: image preview src
  const imgSrc = useMemo(
    () => publicImage((row?.picture_url as string | undefined) || "") || "",
    [row?.picture_url]
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
        const [cQ, dtQ, atQ] = await Promise.all([
          client.from("countries").select("id,name").order("name", { ascending: true }),
          client.from("destination_type").select("id,type").order("id", { ascending: true }),
          client.from("destination_arrival").select("id,type,advice").order("id", { ascending: true }),
        ]);
        if (cQ.error) throw cQ.error;
        if (dtQ.error) throw dtQ.error;
        if (atQ.error) throw atQ.error;

        if (cancelled) return;
        setCountries((cQ.data || []) as Country[]);
        setDestTypes((dtQ.data || []) as DestType[]);
        setArrivalTypes((atQ.data || []) as ArrivalType[]);

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
                // NEW
                "arrival_notes",
                "email",
              ].join(",")
            )
            .eq("id", params.id)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("Destination not found.");
          const r = data as DestinationRow;
          setRow({
            ...r,
            season_from: r.season_from ? toYMD(r.season_from) : null,
            season_to: r.season_to ? toYMD(r.season_to) : null,
          });

          // Preselect arrival type to match wet_or_dry if available
          const match = (atQ.data || []).find(
            (a: any) => (a?.type ?? null) === (r.wet_or_dry ?? null)
          );
          setArrivalChoice(match?.id ?? null);
        } else {
          // sensible defaults for create
          const fresh = emptyDest();
          setRow(fresh);
          const defaultArrival = (atQ.data || []).find((a: any) => a?.type === "dry");
          setArrivalChoice(defaultArrival?.id ?? null);
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

  // When arrivalChoice changes, reflect it in wet_or_dry field
  useEffect(() => {
    const wetdry = selectedArrival?.type ?? null;
    setRow((r) => ({ ...r, wet_or_dry: (wetdry as any) || null }));
  }, [selectedArrival?.type]);

  function update<K extends keyof DestinationRow>(key: K, v: DestinationRow[K]) {
    setRow((r) => ({ ...r, [key]: v }));
  }

  async function handleSave() {
    if (!client) return;
    setErr(null);
    try {
      // Normalise payload to match DB

const payload: DestinationRow = {
  ...row,
  name: String(row.name || "").trim(),
  season_from: row.season_from ? toYMD(row.season_from) : null,
  season_to: row.season_to ? toYMD(row.season_to) : null,
  destination_type: row.destination_type || null,
  wet_or_dry: (row.wet_or_dry as "wet" | "dry" | null) ?? null,

  // normalize ALL optional text fields
  url: norm(row.url),
  gift: norm(row.gift),
  phone: norm(row.phone),
  address1: norm(row.address1),
  address2: norm(row.address2),
  town: norm(row.town),
  region: norm(row.region),
  postal_code: norm(row.postal_code),
  description: norm(row.description),
  picture_url: norm(row.picture_url),

  // NEW — crucial for the constraint
  arrival_notes: norm(row.arrival_notes),
  email: norm(row.email),
};


      // basic guardrails for the check constraints
      const allowedWetDry = new Set(["wet", "dry", null]);
      if (!allowedWetDry.has(payload.wet_or_dry)) {
        throw new Error("Arrival type must be wet or dry.");
      }

      if (isCreate) {
        const { error } = await client.from("destinations").insert(payload as any);
        if (error) throw error;
      } else {
        const { error } = await client
          .from("destinations")
          .update(payload as any)
          .eq("id", params.id);
        if (error) throw error;
      }

      router.push("/admin/destinations");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
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
                  {destTypes.length === 0 && (
                    <>
                      {/* fallback to the check-list if lookup table is empty */}
                      {["Restaurant", "Bar", "Beach Club", "Restaurant & Bar"].map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </>
                  )}
                  {destTypes.map((t) => (
                    <option key={t.id} value={t.type ?? ""}>
                      {t.type ?? ""}
                    </option>
                  ))}
                </select>
              </label>

              {/* Arrival type controls wet/dry + shows advice */}
              <label className="block text-sm">
                <span className="text-neutral-700">Arrival Type (sets wet/dry)</span>
                <select
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={arrivalChoice ?? ""}
                  onChange={(e) => setArrivalChoice(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">—</option>
                  {arrivalTypes.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.type ?? ""}{a.advice ? ` — ${a.advice}` : ""}
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs text-neutral-600">
                  Current wet/dry value: <strong>{row.wet_or_dry ?? "—"}</strong>
                  {selectedArrival?.advice ? (
                    <span> · Advice: {selectedArrival.advice}</span>
                  ) : null}
                </div>
              </label>
            </div>

            {/* Image + URL */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Picture URL</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.picture_url ?? ""}
                  onChange={(e) => update("picture_url", e.target.value || null)}
                  placeholder="https://…"
                />
              </label>

              {row.picture_url ? (
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
              ) : (
                <div className="text-xs text-neutral-500">
                  Add a picture URL or a storage key (e.g. <code>images/foo.jpg</code>) to preview it here.
                </div>
              )}

              <label className="block text-sm">
                <span className="text-neutral-700">Website URL</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.url ?? ""}
                  onChange={(e) => update("url", e.target.value || null)}
                  placeholder="https://example.com"
                />
              </label>

              {/* NEW: Destination contact email */}
              <label className="block text-sm">
                <span className="text-neutral-700">Destination contact email</span>
                <input
  type="email"
  inputMode="email"
  className="w-full mt-1 border rounded-lg px-3 py-2"
  value={row.email ?? ""}
  onChange={(e) => update("email", e.target.value)}
  onBlur={(e) => update("email", e.target.value.trim())}
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

              {/* NEW: Arrival notes (passenger guidance used in emails) */}
              <label className="block text-sm">
                <span className="text-neutral-700">Arrival notes (shown to passengers)</span>
                <textarea
                  className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[100px]"
                  value={row.arrival_notes ?? ""}
                  onChange={(e) => update("arrival_notes", e.target.value || null)}
                  placeholder="e.g., Disembark at Dock B, follow the blue signs to the main gate. Security check required."
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
