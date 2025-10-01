"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase browser client ---------- */
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
  picture_url: string | null; // storage path or full URL (legacy)
  min_val_threshold: number | null;
  type_id: string | null;      // journey_types.id as string
  operator_id: string | null;  // requires column in DB
};

/* ---------- Storage config ---------- */
const STORAGE_BUCKET = "images";
const STORAGE_PREFIX = "vehicles"; // => images/vehicles/<vehicleId>/filename
function isHttpUrl(s?: string | null) { return !!s && /^https?:\/\//i.test(s); }
async function signedUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  if (error) return null;
  return data?.signedUrl ?? null;
}

/* ---------- Helpers ---------- */
const toInt = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));
const toFloat = (v: string) => (v.trim() === "" ? null : Number.parseFloat(v));

export default function VehiclesPage() {
  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  /* Rows */
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* Form */
  const [editingId, setEditingId] = useState<string | null>(null);
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

  /* UI */
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  /* Derived */
  const allowedTypeIdsForOperator = useMemo(
    () => new Set(opTypeRels.filter(r => r.operator_id === operatorId).map(r => r.journey_type_id)),
    [opTypeRels, operatorId]
  );
  const allowedTypes = useMemo(
    () => journeyTypes.filter(jt => allowedTypeIdsForOperator.has(jt.id)),
    [journeyTypes, allowedTypeIdsForOperator]
  );
  const operatorName = (id: string | null | undefined) => operators.find(o => o.id === id)?.name ?? "—";
  const journeyTypeName = (id: string | null | undefined) => journeyTypes.find(j => j.id === id)?.name ?? "—";

  /* Signed URLs for pictures */
  const [picUrlMap, setPicUrlMap] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let off = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async r => [r.id, await signedUrl(r.picture_url || null)] as const)
      );
      if (!off) setPicUrlMap(Object.fromEntries(entries));
    })();
    return () => { off = true; };
  }, [rows]);

  /* Initial load */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [ops, jts, rels, vs] = await Promise.all([
        sb.from("operators").select("id,name,country_id").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb.from("vehicles").select("*").order("created_at", { ascending: false }),
      ]);
      if (off) return;

      if (ops.error || jts.error || rels.error || vs.error) {
        console.error({ ops: ops.error, jts: jts.error, rels: rels.error, vs: vs.error });
        setMsg(ops.error?.message || jts.error?.message || rels.error?.message || vs.error?.message || "Load failed");
      }

      setOperators((ops.data as Operator[]) || []);
      setJourneyTypes((jts.data as JourneyType[]) || []);
      setOpTypeRels((rels.data as OperatorTypeRel[]) || []);
      setRows((vs.data as VehicleRow[]) || []);
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  async function reloadRows() {
    const { data, error } = await sb.from("vehicles").select("*").order("created_at", { ascending: false });
    if (error) return setMsg(error.message);
    setRows((data as VehicleRow[]) || []);
  }

  function resetForm() {
    setEditingId(null);
    setOperatorId("");
    setTypeId("");
    setName("");
    setMinSeats("");
    setMaxSeats("");
    setMinValue("");
    setMinValThreshold("");
    setDescription("");
    setActive(true);
    setPictureFile(null);
    setMsg(null);
  }

  async function loadOne(id: string) {
    setMsg(null);
    const { data, error } = await sb.from("vehicles").select("*").eq("id", id).single();
    if (error || !data) {
      setMsg(error?.message ?? "Could not load vehicle.");
      return;
    }
    setEditingId(id);
    setOperatorId((data as VehicleRow).operator_id ?? "");
    setTypeId((data as VehicleRow).type_id ?? "");
    setName((data as VehicleRow).name ?? "");
    setMinSeats(String((data as VehicleRow).minseats ?? ""));
    setMaxSeats(String((data as VehicleRow).maxseats ?? ""));
    setMinValue(String((data as VehicleRow).minvalue ?? ""));
    setMinValThreshold(String((data as VehicleRow).min_val_threshold ?? ""));
    setDescription((data as VehicleRow).description ?? "");
    setActive((data as VehicleRow).active ?? true);
    setPictureFile(null);
    setMsg(`Editing: ${(data as VehicleRow).name}`);
  }

  /* Upload file -> return storage path */
  async function uploadPictureIfAny(vehicleId: string): Promise<string | null> {
    if (!pictureFile) return null;
    const safe = pictureFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `${STORAGE_PREFIX}/${vehicleId}/${Date.now()}-${safe}`;
    const { error } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, pictureFile, { cacheControl: "3600", upsert: true, contentType: pictureFile.type || "image/*" });
    if (error) { setMsg(`Image upload failed: ${error.message}`); return null; }
    return path;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);

      if (!operatorId) return setMsg("Please choose an Operator.");
      if (!name.trim()) return setMsg("Please enter a Vehicle name.");
      if (!typeId) return setMsg("Please select a Transport Type.");
      const minS = toInt(minSeats); const maxS = toInt(maxSeats); const minV = toFloat(minValue);
      if (minS == null || maxS == null || minV == null) return setMsg("Seats and Min Value are required.");

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
          picture_url: null as string | null, // set after upload
        };
        const res = await fetch(`/api/admin/vehicles`, {
          method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
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
            const patch = await fetch(`/api/admin/vehicles/${id}`, {
              method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ picture_url: path }),
            });
            if (!patch.ok) {
              const body = await patch.json().catch(() => ({}));
              setMsg(body?.error || `Image save failed (${patch.status})`);
            }
          }
        }

        setMsg("Created ✅");
        await reloadRows();
        resetForm();
      } else {
        // UPDATE
        const id = editingId;
        const path = await uploadPictureIfAny(id);
        const payload: Record<string, any> = {
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
        if (path) payload.picture_url = path;

        const res = await fetch(`/api/admin/vehicles/${id}`, {
          method: "PATCH", headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Update failed (${res.status})`);
        }
        setMsg("Updated ✅");
        await reloadRows();
        resetForm();
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(row: VehicleRow) {
    if (!confirm(`Delete vehicle "${row.name}"?`)) return;
    setMsg(null);
    setDeletingId(row.id);
    const res = await fetch(`/api/admin/vehicles/${row.id}`, { method: "DELETE", headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeletingId(null);
      return setMsg(body?.error || `Delete failed (${res.status})`);
    }
    await reloadRows();
    setDeletingId(null);
    setMsg("Deleted.");
    if (editingId === row.id) resetForm();
  }

  /* ---------- TABLE FILTER (tiny change): limit to selected operator ---------- */
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();

    // If an operator is selected, limit the table to that operator's vehicles
    const base = operatorId ? rows.filter(r => r.operator_id === operatorId) : rows;

    if (!s) return base;

    return base.filter(r =>
      r.name.toLowerCase().includes(s) ||
      operatorName(r.operator_id).toLowerCase().includes(s) ||
      journeyTypeName(r.type_id).toLowerCase().includes(s)
    );
  }, [rows, q, operatorId, operators, journeyTypes]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Vehicles</h1>
        <p className="text-neutral-600">Create, edit and delete vehicles. Images upload to Storage and transport type options are limited by the selected Operator.</p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Operator *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={operatorId}
                      onChange={(e) => { setOperatorId(e.target.value); setTypeId(""); }}>
                <option value="">— Select —</option>
                {operators.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Transport Type *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={typeId}
                      onChange={(e) => setTypeId(e.target.value)} disabled={!operatorId}>
                <option value="">— Select —</option>
                {allowedTypes.map(jt => <option key={jt.id} value={jt.id}>{jt.name}</option>)}
              </select>
              {!operatorId && <p className="text-xs text-neutral-500 mt-1">Choose an Operator to see allowed types.</p>}
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Vehicle Name *</label>
              <input className="w-full border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Min Seats *</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="numeric" value={minSeats} onChange={(e) => setMinSeats(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Max Seats *</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="numeric" value={maxSeats} onChange={(e) => setMaxSeats(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Min Value *</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="decimal" value={minValue} onChange={(e) => setMinValue(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Min Value Threshold</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="decimal" value={minValThreshold} onChange={(e) => setMinValThreshold(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 mb-1">Description</label>
            <textarea className="w-full border rounded-lg px-3 py-2" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Picture</label>
              <input type="file" accept="image/*" onChange={(e) => setPictureFile(e.target.files?.[0] || null)} />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in bucket <code>{STORAGE_BUCKET}</code> at <code>{STORAGE_PREFIX}/&lt;vehicleId&gt;/</code>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 mt-6">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                <span className="text-sm">Active</span>
              </label>
            </div>
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
            {editingId && (
              <button type="button" className="inline-flex rounded-full px-4 py-2 border text-sm" onClick={resetForm} disabled={saving}>
                Cancel
              </button>
            )}
            {msg && <span className="text-sm text-neutral-600">{msg}</span>}
          </div>
        </form>
      </section>

      {/* Table */}
      <section className="space-y-3">
        <div className="flex gap-2">
          <input className="border rounded-lg px-3 py-2" placeholder="Search vehicles…"
                 value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No vehicles yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Vehicle</th>
                  <th className="text-left p-3">Operator</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-left p-3">Seats</th>
                  <th className="text-left p-3">Min Value</th>
                  <th className="text-left p-3">Picture</th>
                  <th className="text-left p-3">Active</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3">
                      <button className="px-2 py-1 rounded-full border" onClick={() => loadOne(r.id)} title="Edit">
                        {r.name}
                      </button>
                    </td>
                    <td className="p-3">{operatorName(r.operator_id)}</td>
                    <td className="p-3">{journeyTypeName(r.type_id)}</td>
                    <td className="p-3">{r.minseats}–{r.maxseats}</td>
                    <td className="p-3">{r.minvalue}</td>
                    <td className="p-3">
                      {picUrlMap[r.id] ? (
                        <img src={picUrlMap[r.id]!} alt={r.name} className="h-10 w-16 object-cover rounded border" />
                      ) : (
                        <div className="h-10 w-16 rounded border bg-neutral-100" />
                      )}
                    </td>
                    <td className="p-3">{(r.active ?? true) ? "Yes" : "No"}</td>
                    <td className="p-3 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => loadOne(r.id)}>Edit</button>
                      <button className="px-3 py-1 rounded-full border" onClick={() => onRemove(r)} disabled={deletingId === r.id}>
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
