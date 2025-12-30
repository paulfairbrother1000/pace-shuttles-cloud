"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* -------- Supabase (client-side) -------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* -------- Types -------- */
type Country = { id: string; name: string };
type TransportType = { id: string; name: string };
type TransportPlace = { id: string; transport_type_id: string; name: string };

type PickupPointRow = {
  id: string;
  country_id: string;
  name: string;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  picture_url: string | null; // FULL public URL in your current data
  description: string | null;
  transport_type_id: string;
  transport_type_place_id: string | null;
  arrival_notes: string | null;
  active: boolean;
};

/* -------- Helpers -------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function extFromFileName(name: string) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m?.[1] ?? "jpg";
}

export default function AdminPickupPointEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const idParam = params?.id;
  const isNew = idParam === "new";

  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<TransportType[]>([]);
  const [places, setPlaces] = useState<TransportPlace[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [form, setForm] = useState<PickupPointRow>(() => ({
    id: "",
    country_id: "",
    name: "",
    address1: null,
    address2: null,
    town: null,
    region: null,
    postal_code: null,
    picture_url: null,
    description: null,
    transport_type_id: "",
    transport_type_place_id: null,
    arrival_notes: null,
    active: true,
  }));

  // Image state
  const [imageMode, setImageMode] = useState<"upload" | "url">("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrlInput, setImageUrlInput] = useState<string>("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  function set<K extends keyof PickupPointRow>(k: K, v: PickupPointRow[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  /* Load lookups + row */
  useEffect(() => {
    let off = false;

    (async () => {
      if (!sb) {
        setMsg("Supabase client is not configured.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setMsg(null);

      try {
        const [cQ, tQ, pQ] = await Promise.all([
          sb.from("countries").select("id,name").order("name"),
          sb.from("transport_types").select("id,name").order("name"),
          sb.from("transport_type_places").select("id,transport_type_id,name").order("name"),
        ]);
        if (cQ.error) throw cQ.error;
        if (tQ.error) throw tQ.error;
        if (pQ.error) throw pQ.error;

        if (off) return;

        setCountries((cQ.data || []) as Country[]);
        setTypes((tQ.data || []) as TransportType[]);
        setPlaces((pQ.data || []) as TransportPlace[]);

        if (!isNew) {
          const { data, error } = await sb
            .from("pickup_points")
            .select("*")
            .eq("id", idParam)
            .maybeSingle();

          if (error) throw error;
          if (!data) throw new Error("Pick-up point not found.");

          const r = data as PickupPointRow;

          setForm(r);
          setImagePreview(r.picture_url);
          if (isHttp(r.picture_url)) {
            setImageMode("url");
            setImageUrlInput(r.picture_url ?? "");
          } else {
            setImageMode("upload");
          }
        } else {
          // new: leave form blank
          setForm((p) => ({ ...p, id: "" }));
          setImagePreview(null);
          setImageMode("upload");
          setImageUrlInput("");
          setImageFile(null);
        }
      } catch (e: any) {
        if (!off) setMsg(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();

    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idParam]);

  /* Places filtered by selected type */
  const placesForSelectedType = useMemo(() => {
    if (!form.transport_type_id) return [];
    return places.filter((p) => p.transport_type_id === form.transport_type_id);
  }, [places, form.transport_type_id]);

  /* Local preview for uploaded file */
  useEffect(() => {
    if (!imageFile) return;
    const objUrl = URL.createObjectURL(imageFile);
    setImagePreview(objUrl);
    return () => URL.revokeObjectURL(objUrl);
  }, [imageFile]);

  /* Preview for pasted URL */
  useEffect(() => {
    if (imageMode !== "url") return;
    const v = imageUrlInput.trim();
    setImagePreview(v && isHttp(v) ? v : null);
  }, [imageMode, imageUrlInput]);

  async function uploadImageIfNeeded(): Promise<string | null> {
    if (!sb) throw new Error("Supabase not configured");

    // URL mode: store full URL (your DB already stores full URL)
    if (imageMode === "url") {
      const url = imageUrlInput.trim();
      if (!url) return null;
      if (!isHttp(url)) throw new Error("Image URL must start with http(s)://");
      return url;
    }

    // Upload mode: if no file picked, keep existing picture_url
    if (!imageFile) return form.picture_url ?? null;

    // Flat path under pickup-points/ using slug(name)
    const ext = extFromFileName(imageFile.name);
    const base = slugify(form.name || "pickup-point") || "pickup-point";
    const objectPath = `pickup-points/${base}.${ext}`; // bucket: images

    const { error } = await sb.storage.from("images").upload(objectPath, imageFile, {
      upsert: true,
      contentType: imageFile.type || undefined,
    });
    if (error) throw error;

    // Store FULL public URL (matches your existing rows)
    const pub = sb.storage.from("images").getPublicUrl(objectPath).data.publicUrl;
    return pub || null;
  }

  async function onSave() {
    if (!sb) {
      setMsg("Supabase client is not configured.");
      return;
    }
    setMsg(null);

    if (!form.name.trim()) return setMsg("Name is required.");
    if (!form.country_id) return setMsg("Country is required.");
    if (!form.transport_type_id) return setMsg("Transport type is required.");

    setSaving(true);
    try {
      const picture_url = await uploadImageIfNeeded();

      const payload = {
        country_id: form.country_id,
        name: form.name.trim(),
        address1: form.address1?.trim() ? form.address1.trim() : null,
        address2: form.address2?.trim() ? form.address2.trim() : null,
        town: form.town?.trim() ? form.town.trim() : null,
        region: form.region?.trim() ? form.region.trim() : null,
        postal_code: form.postal_code?.trim() ? form.postal_code.trim() : null,
        picture_url,
        description: form.description?.trim() ? form.description.trim() : null,
        transport_type_id: form.transport_type_id,
        transport_type_place_id: form.transport_type_place_id || null,
        arrival_notes: form.arrival_notes?.trim() ? form.arrival_notes.trim() : null,
        active: !!form.active,
      };

      if (isNew) {
        const { error } = await sb.from("pickup_points").insert(payload);
        if (error) throw error;
      } else {
        const { error } = await sb.from("pickup_points").update(payload).eq("id", idParam);
        if (error) throw error;
      }

      router.push("/admin/pickups");
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-[900px] mx-auto px-4 py-6">
        <div className="rounded-2xl border bg-white p-4">Loading…</div>
      </div>
    );
  }

  return (
    <div className="max-w-[900px] mx-auto px-4 py-6 space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Admin • Pick-up Points • {isNew ? "New" : "Edit"}
          </h1>
          <p className="text-sm text-neutral-600">
            {isNew ? "Create a new pick-up point." : "Update this pick-up point."}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link
            href="/admin/pickups"
            className="rounded-full px-4 py-2 border text-sm hover:bg-neutral-50"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-full px-4 py-2 bg-blue-600 text-white text-sm hover:opacity-90 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: main fields */}
        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border bg-white p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Name *</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.name}
                  onChange={(e) => set("name", e.target.value)}
                />
              </div>

              <div>
                <label className="text-sm font-medium">Country *</label>
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.country_id}
                  onChange={(e) => set("country_id", e.target.value)}
                >
                  <option value="">Select…</option>
                  {countries.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Active</label>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    id="active"
                    type="checkbox"
                    checked={!!form.active}
                    onChange={(e) => set("active", e.target.checked)}
                  />
                  <label htmlFor="active" className="text-sm text-neutral-700">
                    Visible to users
                  </label>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">Transport type *</label>
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.transport_type_id}
                  onChange={(e) => {
                    set("transport_type_id", e.target.value);
                    set("transport_type_place_id", null);
                  }}
                >
                  <option value="">Select…</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium">Transport place</label>
                <select
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.transport_type_place_id ?? ""}
                  onChange={(e) => set("transport_type_place_id", e.target.value || null)}
                  disabled={!form.transport_type_id}
                >
                  <option value="">None</option>
                  {placesForSelectedType.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Description</label>
                <textarea
                  className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[90px]"
                  value={form.description ?? ""}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-sm font-medium">Arrival notes</label>
                <textarea
                  className="mt-1 w-full border rounded-lg px-3 py-2 min-h-[90px]"
                  value={form.arrival_notes ?? ""}
                  onChange={(e) => set("arrival_notes", e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 space-y-3">
            <div className="text-sm font-medium">Address</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="text-sm text-neutral-700">Address line 1</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.address1 ?? ""}
                  onChange={(e) => set("address1", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-sm text-neutral-700">Address line 2</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.address2 ?? ""}
                  onChange={(e) => set("address2", e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-neutral-700">Town</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.town ?? ""}
                  onChange={(e) => set("town", e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-neutral-700">Region</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.region ?? ""}
                  onChange={(e) => set("region", e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm text-neutral-700">Postal code</label>
                <input
                  className="mt-1 w-full border rounded-lg px-3 py-2"
                  value={form.postal_code ?? ""}
                  onChange={(e) => set("postal_code", e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right: image */}
        <div className="space-y-4">
          <div className="rounded-2xl border bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Image</div>
              <div className="flex gap-2 text-sm">
                <button
                  type="button"
                  className={`px-3 py-1 rounded-full border ${
                    imageMode === "upload" ? "bg-neutral-900 text-white" : "bg-white"
                  }`}
                  onClick={() => setImageMode("upload")}
                >
                  Upload
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 rounded-full border ${
                    imageMode === "url" ? "bg-neutral-900 text-white" : "bg-white"
                  }`}
                  onClick={() => setImageMode("url")}
                >
                  URL
                </button>
              </div>
            </div>

            <div className="h-44 w-full overflow-hidden rounded-xl bg-neutral-50 border">
              {imagePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imagePreview}
                  alt="Preview"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/placeholder.png";
                  }}
                />
              ) : (
                <div className="h-full w-full flex items-center justify-center text-sm text-neutral-500">
                  No image
                </div>
              )}
            </div>

            {imageMode === "upload" ? (
              <div className="space-y-2">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                />
                <div className="text-xs text-neutral-600">
                  Uploads to <code>images/pickup-points/</code> and stores the{" "}
                  <strong>full public URL</strong> in <code>picture_url</code>.
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="https://…"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                />
                <div className="text-xs text-neutral-600">
                  Stores the full URL in <code>picture_url</code>.
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border bg-white p-4 space-y-2">
            <div className="text-sm font-medium">Tip</div>
            <div className="text-xs text-neutral-600">
              If you rename the pick-up point, the existing image file name won’t change unless you
              upload a new one.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
