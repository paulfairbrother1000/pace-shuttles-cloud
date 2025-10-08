"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Operator = { id: string; name: string; country_id: string | null };
type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: string; journey_type_id: string };
type VehicleRow = {
  id: string;
  name: string;
  active: boolean | null;
  created_at: string;
  minseats: number;
  maxseats: number;
  minvalue: number;
  description: string;
  picture_url: string | null;
  min_val_threshold: number | null;
  type_id: string | null;
  operator_id: string | null;
};

/* ---------- Storage ---------- */
const STORAGE_BUCKET = "images";
const STORAGE_PREFIX = "vehicles";

/* ---------- Helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolvePic(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from(STORAGE_BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}
const toInt = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));
const toFloat = (v: string) => (v.trim() === "" ? null : Number.parseFloat(v));

export default function VehicleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = !params?.id || params.id === "new";

  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  /* Form state */
  const [editingId, setEditingId] = useState<string | null>(isNew ? null : params.id);
  const [operatorId, setOperatorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [name, setName] = useState("");
  const [minSeats, setMinSeats] = useState("");
  const [maxSeats, setMaxSeats] = useState("");
  const [minValue, setMinValue] = useState("");
  const [minValThreshold, setMinValThreshold] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [pictureFile, setPictureFile] = useState<File | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* Load lookups + record */
  useEffect(() => {
    let off = false;
    (async () => {
      const [ops, jts, rels] = await Promise.all([
        sb.from("operators").select("id,name,country_id").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);
      if (ops.error || jts.error || rels.error) {
        setMsg(ops.error?.message || jts.error?.message || rels.error?.message || "Load failed");
      }
      if (off) return;
      setOperators((ops.data as Operator[]) || []);
      setJourneyTypes((jts.data as JourneyType[]) || []);
      setOpTypeRels((rels.data as OperatorTypeRel[]) || []);

      if (isNew) {
        setLoading(false);
        return;
      }

      const { data, error } = await sb.from("vehicles").select("*").eq("id", params.id).single();
      if (error || !data) {
        setMsg(error?.message || "Load failed");
        setLoading(false);
        return;
      }
      const v = data as VehicleRow;
      setEditingId(v.id);
      setOperatorId(v.operator_id ?? "");
      setTypeId(v.type_id ?? "");
      setName(v.name ?? "");
      setMinSeats(String(v.minseats ?? ""));
      setMaxSeats(String(v.maxseats ?? ""));
      setMinValue(String(v.minvalue ?? ""));
      setMinValThreshold(String(v.min_val_threshold ?? ""));
      setDescription(v.description ?? "");
      setActive(v.active ?? true);
      setExistingPath(v.picture_url ?? null);
      setPreviewUrl(await resolvePic(v.picture_url ?? null));
      setLoading(false);
    })();
    return () => { off = true; };
  }, [isNew, params?.id]);

  /* Allowed journey types for selected operator */
  const allowedTypeIdsForOperator = useMemo(
    () => new Set(opTypeRels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id)),
    [opTypeRels, operatorId]
  );
  const allowedTypes = useMemo(
    () => journeyTypes.filter((jt) => allowedTypeIdsForOperator.has(jt.id)),
    [journeyTypes, allowedTypeIdsForOperator]
  );

  async function uploadPictureIfAny(vehicleId: string): Promise<string | null> {
    if (!pictureFile) return null;
    const safe = pictureFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `${STORAGE_PREFIX}/${vehicleId}/${Date.now()}-${safe}`;
    const { error } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, pictureFile, { cacheControl: "3600", upsert: true, contentType: pictureFile.type || "image/*" });
    if (error) {
      setMsg(`Image upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);
      if (!operatorId) return setMsg("Please choose an Operator.");
      if (!name.trim()) return setMsg("Please enter a Vehicle name.");
      if (!typeId) return setMsg("Please select a Transport Type.");

      const minS = toInt(minSeats);
      const maxS = toInt(maxSeats);
      const minV = toFloat(minValue);
      if (minS == null || maxS == null || minV == null)
        return setMsg("Seats and Min Value are required.");

      setSaving(true);

      if (!editingId) {
        // CREATE
        const payload = {
          operator_id: operatorId,
          type_id: typeId,
          name: name.trim(),
          active,
          minseats: minS,
          maxseats: maxS,
          minvalue: minV,
          description: description.trim() || "",
          min_val_threshold: toFloat(minValThreshold),
          picture_url: null as string | null,
        };
        const res = await fetch(`/api/admin/vehicles`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Create failed (${res.status})`);
        }
        const { id } = await res.json();

        if (id && pictureFile) {
          const path = await uploadPictureIfAny(id);
          if (path) {
            await fetch(`/api/admin/vehicles/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ picture_url: path }),
            });
          }
        }
        router.push("/admin/vehicles");
      } else {
        // UPDATE
        const id = editingId;
        const toUpdate: Record<string, any> = {
          operator_id: operatorId,
          type_id: typeId,
          name: name.trim(),
          active,
          minseats: minS,
          maxseats: maxS,
          minvalue: minV,
          description: description.trim() || "",
          min_val_threshold: toFloat(minValThreshold),
        };
        if (pictureFile) {
          const path = await uploadPictureIfAny(id);
          if (path) toUpdate.picture_url = path;
        }
        const res = await fetch(`/api/admin/vehicles/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(toUpdate),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Update failed (${res.status})`);
        }
        router.push("/admin/vehicles");
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (!confirm("Delete this vehicle?")) return;
    const res = await fetch(`/api/admin/vehicles/${editingId}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setMsg(body?.error || `Delete failed (${res.status})`);
    }
    router.push("/admin/vehicles");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/admin/vehicles" className="rounded-full px-3 py-1 border text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">{isNew ? "New Vehicle" : "Edit Vehicle"}</h1>
        <div className="ml-auto">
          {!isNew && (
            <button onClick={onDelete} className="rounded-full px-4 py-2 border text-sm">
              Delete
            </button>
          )}
        </div>
      </div>

      {msg && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow">
        {loading ? (
          <div>Loading…</div>
        ) : (
          <form onSubmit={onSave} className="space-y-6">
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Operator *</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={operatorId}
                  onChange={(e) => {
                    setOperatorId(e.target.value);
                    setTypeId("");
                  }}
                >
                  <option value="">— Select —</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Transport Type *</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                  disabled={!operatorId}
                >
                  <option value="">— Select —</option>
                  {allowedTypes.map((jt) => (
                    <option key={jt.id} value={jt.id}>
                      {jt.name}
                    </option>
                  ))}
                </select>
                {!operatorId && (
                  <p className="text-xs text-neutral-500 mt-1">
                    Choose an Operator to see allowed types.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Vehicle Name *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
            </div>

            <div className="grid md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Min Seats *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  inputMode="numeric"
                  value={minSeats}
                  onChange={(e) => setMinSeats(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Max Seats *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  inputMode="numeric"
                  value={maxSeats}
                  onChange={(e) => setMaxSeats(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Min Value *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  inputMode="decimal"
                  value={minValue}
                  onChange={(e) => setMinValue(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Min Value Threshold</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  inputMode="decimal"
                  value={minValThreshold}
                  onChange={(e) => setMinValThreshold(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Description</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Image</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    setPictureFile(f);
                    setPreviewUrl(f ? URL.createObjectURL(f) : await resolvePic(existingPath));
                  }}
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Stored in <code>{STORAGE_BUCKET}/{STORAGE_PREFIX}/&lt;vehicleId&gt;/</code>
                </p>
              </div>
              {previewUrl && (
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">Preview</label>
                  <div className="h-32 w-48 border rounded overflow-hidden">
                    <img src={previewUrl} alt="preview" className="h-full w-full object-cover" />
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={
                  saving ||
                  !operatorId ||
                  !typeId ||
                  !name.trim() ||
                  toInt(minSeats) == null ||
                  toInt(maxSeats) == null ||
                  toFloat(minValue) == null
                }
                className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : editingId ? "Update Vehicle" : "Create Vehicle"}
              </button>
              <Link href="/admin/vehicles" className="inline-flex rounded-full px-4 py-2 border text-sm">
                Cancel
              </Link>
              {msg && <span className="text-sm text-neutral-600">{msg}</span>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
