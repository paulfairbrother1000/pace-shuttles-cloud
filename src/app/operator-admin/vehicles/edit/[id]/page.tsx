"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase (browser) ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: string; name: string; country_id: string | null };
type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: string; journey_type_id: string };

type VehicleRow = {
  id: string;
  name: string;
  active: boolean | null;
  created_at: string | null;
  minseats: number;
  maxseats: number;
  minvalue: number;
  description: string;
  picture_url: string | null;
  min_val_threshold: number | null;
  type_id: string | null;
  operator_id: string | null;
};

/* ---------- Helpers ---------- */
const toInt = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));
const toFloat = (v: string) => (v.trim() === "" ? null : Number.parseFloat(v));

export default function VehicleEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = !params?.id || params.id === "new";

  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
      if (u?.operator_admin && u.operator_id) {
        setOperatorId((cur) => cur || u.operator_id!);
      }
    } catch {
      setPsUser(null);
    }
  }, []);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  /* Form state */
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
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /* Allowed types for selected operator */
  const allowedTypeIds = useMemo(
    () => new Set(opTypeRels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id)),
    [opTypeRels, operatorId]
  );
  const allowedTypes = useMemo(
    () => journeyTypes.filter((t) => allowedTypeIds.has(t.id)),
    [journeyTypes, allowedTypeIds]
  );

  /* Load lookups + vehicle (if editing) */
  useEffect(() => {
    let off = false;
    (async () => {
      const [ops, jts, rels] = await Promise.all([
        sb.from("operators").select("id,name,country_id").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);

      if (ops.data) setOperators(ops.data as Operator[]);
      if (jts.data) setJourneyTypes(jts.data as JourneyType[]);
      if (rels.data) setOpTypeRels(rels.data as OperatorTypeRel[]);

      if (!isNew && params?.id) {
        const { data, error } = await sb.from("vehicles").select("*").eq("id", params.id).single();
        if (error || !data) {
          setMsg(error?.message ?? "Could not load vehicle.");
        } else {
          const v = data as VehicleRow;
          setOperatorId(v.operator_id ?? "");
          setTypeId(v.type_id ?? "");
          setName(v.name ?? "");
          setMinSeats(String(v.minseats ?? ""));
          setMaxSeats(String(v.maxseats ?? ""));
          setMinValue(String(v.minvalue ?? ""));
          setMinValThreshold(String(v.min_val_threshold ?? ""));
          setDescription(v.description ?? "");
          setActive(v.active ?? true);
        }
      } else {
        // New form: default operator for op-admins
        if (operatorLocked && psUser?.operator_id) setOperatorId(psUser.operator_id);
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, params?.id]);

  function resetAndBack(message?: string) {
    if (message) setMsg(message);
    router.push("/operator-admin/vehicles");
  }

  async function uploadPictureIfAny(vehicleId: string): Promise<string | null> {
    if (!pictureFile) return null;
    const safe = pictureFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `vehicles/${vehicleId}/${Date.now()}-${safe}`;
    const { error } = await sb.storage
      .from("images")
      .upload(path, pictureFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: pictureFile.type || "image/*",
      });
    if (error) {
      setMsg(`Image upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

  /* ---------- Save ---------- */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();

    const effectiveOperatorId = operatorLocked ? (psUser?.operator_id || "") : operatorId;
    if (!effectiveOperatorId) return setMsg("Please choose an Operator.");
    if (!typeId) return setMsg("Please select a Transport Type.");
    if (!name.trim()) return setMsg("Please enter a Vehicle name.");

    const minS = toInt(minSeats),
      maxS = toInt(maxSeats),
      minV = toFloat(minValue);
    if (minS == null || maxS == null || minV == null) {
      return setMsg("Seats and Min Value are required.");
    }

    setSaving(true);
    setMsg(null);

    try {
      if (isNew) {
        const payload = {
          operator_id: effectiveOperatorId,
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
            const patch = await fetch(`/api/admin/vehicles/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ picture_url: path }),
            });
            if (!patch.ok) {
              const body = await patch.json().catch(() => ({}));
              setMsg(body?.error || `Image save failed (${patch.status})`);
            }
          }
        }

        resetAndBack("Created ✅");
      } else {
        const id = params.id as string;
        const path = await uploadPictureIfAny(id);

        const payload: Record<string, any> = {
          operator_id: effectiveOperatorId,
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
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Update failed (${res.status})`);
        }

        resetAndBack("Updated ✅");
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  /* ---------- Delete ---------- */
  async function onDelete() {
    if (isNew || !params?.id) return;
    if (!confirm("Delete this vehicle?")) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/vehicles/${params.id}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleting(false);
        return setMsg(body?.error || `Delete failed (${res.status})`);
      }
      resetAndBack("Deleted.");
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
      setDeleting(false);
    }
  }

  const lockedOperatorName =
    (operatorLocked && (psUser?.operator_name || operators.find((o) => o.id === psUser!.operator_id!)?.name)) || "";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.back()}
          className="rounded-full border px-3 py-1 text-sm"
        >
          ← Back
        </button>
        {!isNew && (
          <button
            id="delete"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-full border px-3 py-1 text-sm"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      <header>
        <h1 className="text-2xl font-semibold">{isNew ? "New Vehicle" : "Edit Vehicle"}</h1>
        {operatorLocked && (
          <p className="text-neutral-600">Operator is locked to <strong>{lockedOperatorName || psUser?.operator_id}</strong>.</p>
        )}
        {msg && <p className="text-sm text-red-600 mt-1">{msg}</p>}
      </header>

      <section className="rounded-2xl border bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Operator *</label>
              {operatorLocked ? (
                <div className="inline-flex rounded-full bg-neutral-100 border px-3 py-2 text-sm">
                  {lockedOperatorName || psUser?.operator_id}
                </div>
              ) : (
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
              )}
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
                {allowedTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {!operatorId && (
                <p className="text-xs text-neutral-500 mt-1">Choose an Operator to see allowed types.</p>
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
              <label className="block text-sm text-neutral-600 mb-1">Picture</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPictureFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in bucket <code>images</code> at <code>vehicles/&lt;vehicleId&gt;/</code>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 mt-6">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
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
              {saving ? "Saving…" : isNew ? "Create Vehicle" : "Update Vehicle"}
            </button>
            <button
              type="button"
              className="inline-flex rounded-full px-4 py-2 border text-sm"
              onClick={() => router.back()}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
