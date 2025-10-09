"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

type UUID = string;

type Country = { id: UUID; name: string };
type TransportType = { id: UUID; name: string };
type TransportPlace = { id: UUID; transport_type_id: UUID; name: string };

type Row = {
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
  // NEW
  arrival_notes: string | null;
};

const BUCKET = "images";
const FOLDER = "pickup-points";

const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function EditPickupPointPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isCreate = params.id === "new";

  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<TransportType[]>([]);
  const [places, setPlaces] = useState<TransportPlace[]>([]);

  const [row, setRow] = useState<Row>({
    id: "" as UUID,
    name: "",
    country_id: null,
    picture_url: null,
    description: null,
    address1: null,
    address2: null,
    town: null,
    region: null,
    postal_code: null,
    transport_type_id: null,
    transport_type_place_id: null,
    // NEW
    arrival_notes: null,
  });

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const placesForType = useMemo(
    () => places.filter((p) => p.transport_type_id === row.transport_type_id),
    [places, row.transport_type_id]
  );

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

        if (!isCreate) {
          const { data, error } = await sb
            .from("pickup_points")
            .select("*")
            .eq("id", params.id)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("Pick-up point not found.");

          setRow(data as Row);
          setPreview(publicImage((data as Row).picture_url) || null);
        } else {
          setRow((r) => ({ ...r, id: "" as UUID }));
          setPreview(null);
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
  }, [isCreate, params.id]);

  function update<K extends keyof Row>(k: K, v: Row[K]) {
    setRow((r) => ({ ...r, [k]: v }));
  }

  async function onSave() {
    if (!sb) return;
    setErr(null);
    setSaving(true);
    try {
      // optional upload
      let picture_url: string | null = row.picture_url ?? null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${FOLDER}/${slugify(row.name || "pickup")}.${ext}`;

        const { error: upErr } = await sb.storage
          .from(BUCKET)
          .upload(path, file, {
            upsert: true,
            cacheControl: "3600",
            contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
          });
        if (upErr) throw upErr;

        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        picture_url = pub?.publicUrl || null;
      }

      const payload = {
        name: (row.name || "").trim(),
        country_id: row.country_id,
        transport_type_id: row.transport_type_id,
        transport_type_place_id: row.transport_type_place_id || null,
        description: (row.description || "") || null,
        address1: (row.address1 || "") || null,
        address2: (row.address2 || "") || null,
        town: (row.town || "") || null,
        region: (row.region || "") || null,
        postal_code: (row.postal_code || "") || null,
        // NEW
        arrival_notes: (row.arrival_notes || "") || null,
        picture_url,
      };

      if (isCreate) {
        const { error } = await sb.from("pickup_points").insert(payload as any);
        if (error) throw error;
      } else {
        const { error } = await sb.from("pickup_points").update(payload as any).eq("id", params.id);
        if (error) throw error;
      }

      router.push("/admin/pickups");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!sb || isCreate) return;
    if (!confirm("Delete this pick-up point? This cannot be undone.")) return;

    setErr(null);
    setDeleting(true);
    try {
      const { count, error: refErr } = await sb
        .from("routes")
        .select("id", { count: "exact", head: true })
        .eq("pickup_id", params.id);
      if (refErr) throw refErr;
      if ((count ?? 0) > 0) throw new Error(`Cannot delete — used by ${count} route(s).`);

      const { error } = await sb.from("pickup_points").delete().eq("id", params.id);
      if (error) throw error;

      router.push("/admin/pickups");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="px-4 py-6 mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-3">
        <button className="px-3 py-1 rounded-lg border hover:bg-neutral-50" onClick={() => router.back()}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">{isCreate ? "New Pick-up Point" : "Edit Pick-up Point"}</h1>
      </header>

      {err && <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-neutral-700">Name *</span>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.name || ""}
                    onChange={(e) => update("name", e.target.value)}
                  />
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700">Country *</span>
                  <select
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.country_id ?? ""}
                    onChange={(e) => update("country_id", (e.target.value || null) as UUID | null)}
                  >
                    <option value="">— Select —</option>
                    {countries.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700">Transport type *</span>
                  <select
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.transport_type_id ?? ""}
                    onChange={(e) => {
                      update("transport_type_id", (e.target.value || null) as UUID | null);
                      update("transport_type_place_id", null);
                    }}
                  >
                    <option value="">— Select —</option>
                    {types.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700">Place (optional)</span>
                  <select
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.transport_type_place_id ?? ""}
                    onChange={(e) =>
                      update("transport_type_place_id", (e.target.value || null) as UUID | null)
                    }
                    disabled={!row.transport_type_id}
                  >
                    <option value="">— None —</option>
                    {placesForType.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-neutral-700">Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      setPreview(
                        f ? URL.createObjectURL(f) : (publicImage(row.picture_url) || null)
                      );
                    }}
                  />
                </label>

                <div className="relative w-full overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview || publicImage(row.picture_url) || "/placeholder.png"}
                    alt={row.name || "preview"}
                    className="w-full h-48 object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = "/placeholder.png";
                    }}
                  />
                </div>

                <label className="block text-sm">
                  <span className="text-neutral-700">Description</span>
                  <textarea
                    className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[96px]"
                    value={row.description || ""}
                    onChange={(e) => update("description", e.target.value || null)}
                  />
                </label>

                {/* NEW: Arrival notes */}
                <label className="block text-sm">
                  <span className="text-neutral-700">Arrival notes (shown to passengers)</span>
                  <textarea
                    className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[96px]"
                    value={row.arrival_notes || ""}
                    onChange={(e) => update("arrival_notes", e.target.value || null)}
                    placeholder="e.g., Meet at the main marina gate. Allow 10 minutes for security. Look for the Pace Shuttles sign."
                  />
                </label>
              </div>

              <div className="space-y-3 md:col-span-2">
                <div className="grid md:grid-cols-3 gap-3">
                  <label className="block text-sm">
                    <span className="text-neutral-700">Address 1</span>
                    <input
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                      value={row.address1 || ""}
                      onChange={(e) => update("address1", e.target.value || null)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-neutral-700">Address 2</span>
                    <input
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                      value={row.address2 || ""}
                      onChange={(e) => update("address2", e.target.value || null)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-neutral-700">Town / City</span>
                    <input
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                      value={row.town || ""}
                      onChange={(e) => update("town", e.target.value || null)}
                    />
                  </label>
                </div>

                <div className="grid md:grid-cols-3 gap-3">
                  <label className="block text-sm">
                    <span className="text-neutral-700">Region / State</span>
                    <input
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                      value={row.region || ""}
                      onChange={(e) => update("region", e.target.value || null)}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-neutral-700">Postal code</span>
                    <input
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                      value={row.postal_code || ""}
                      onChange={(e) => update("postal_code", e.target.value || null)}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="p-4 border-t flex items-center gap-2 justify-end">
              {!isCreate && (
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border text-rose-700 border-rose-300 hover:bg-rose-50"
                  onClick={onDelete}
                  disabled={deleting}
                  title={deleting ? "Deleting…" : "Delete"}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
              <button
                type="button"
                className="px-4 py-2 rounded-lg border hover:bg-neutral-50"
                onClick={() => router.back()}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg text-white disabled:opacity-60"
                style={{ backgroundColor: "#2563eb" }}
                disabled={saving}
                onClick={onSave}
              >
                {saving ? "Saving…" : isCreate ? "Create Pick-up Point" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
