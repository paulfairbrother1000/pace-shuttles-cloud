"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { sb } from "@/lib/supabaseClient"; // ← shared client

/* ───────────────────────── Types ───────────────────────── */
type PsUser = {
  id: string;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: string; name: string };
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
  type_id: string | null;     // journey_types.id
  operator_id: string | null; // operators.id
};

/* NEW: staffing relationship rows */
type StaffRow = {
  id: string;
  operator_id: string;
  first_name: string | null;
  last_name: string | null;
  jobrole: string | null;
  active?: boolean | null; // if present in your schema
  photo_url: string | null;
};

type SVA = {
  id: string;
  operator_id: string;
  vehicle_id: string;
  staff_id: string;
  priority: number; // 1..5
  is_lead_eligible: boolean;
  created_at?: string | null;
};

/* ───────────────────────── Helpers ───────────────────────── */
const toInt = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));
const toFloat = (v: string) => (v.trim() === "" ? null : Number.parseFloat(v));
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

function isLeadRole(job?: string | null) {
  const j = String(job || "").toLowerCase();
  return j.includes("captain") || j.includes("pilot") || j.includes("driver");
}

/** Resolve storage path or raw URL into a browser-loadable URL. */
async function resolveImageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

/* ───────────────────────── Page ───────────────────────── */
export default function EditVehiclePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const vehicleId = params?.id;
  const isNew = vehicleId === "new";

  /* ps_user (locks operator for operator admins) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);

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

  /* Image preview */
  const [storedImageUrl, setStoredImageUrl] = useState<string | null>(null);
  const livePreviewUrl = useMemo(
    () => (pictureFile ? URL.createObjectURL(pictureFile) : null),
    [pictureFile]
  );

  /* UI */
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* Allowed types for selected operator */
  const allowedTypeIds = useMemo(
    () =>
      new Set(
        opTypeRels
          .filter((r) => r.operator_id === operatorId)
          .map((r) => r.journey_type_id)
      ),
    [opTypeRels, operatorId]
  );
  const allowedTypes = useMemo(
    () => journeyTypes.filter((t) => allowedTypeIds.has(t.id)),
    [journeyTypes, allowedTypeIds]
  );

  /* Load lookups + row */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);

      const [ops, jts, rels] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);

      if (ops.data) setOperators(ops.data as Operator[]);
      if (jts.data) setJourneyTypes(jts.data as JourneyType[]);
      if (rels.data) setOpTypeRels(rels.data as OperatorTypeRel[]);

      if (!isNew && vehicleId) {
        const { data, error } = await sb
          .from("vehicles")
          .select("*")
          .eq("id", vehicleId)
          .single();

        if (error || !data) {
          setMsg(error?.message ?? "Vehicle not found.");
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

          const resolved = await resolveImageUrl(v.picture_url);
          setStoredImageUrl(resolved);
        }
      } else {
        // New: pre-fill operator if locked
        if (operatorLocked && psUser?.operator_id) {
          setOperatorId(psUser.operator_id);
        }
      }

      if (!off) setLoading(false);
    })();

    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, isNew, operatorLocked, psUser?.operator_id]);

  /* Upload image -> return storage path */
  async function uploadImageIfAny(id: string): Promise<string | null> {
    if (!pictureFile) return null;
    const safe = pictureFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `vehicles/${id}/${Date.now()}-${safe}`;
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

  async function onSave(e: React.FormEvent) {
    e.preventDefault();

    try {
      setMsg(null);

      const effectiveOperatorId = operatorLocked
        ? psUser?.operator_id || ""
        : operatorId;
      if (!effectiveOperatorId) return setMsg("Please choose an Operator.");
      if (!name.trim()) return setMsg("Please enter a Vehicle name.");
      if (!typeId) return setMsg("Please select a Transport Type.");
      const minS = toInt(minSeats),
        maxS = toInt(maxSeats),
        minV = toFloat(minValue);
      if (minS == null || maxS == null || minV == null)
        return setMsg("Seats and Min Value are required.");

      setSaving(true);

      const basePayload: Record<string, any> = {
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

      if (isNew) {
        // Create
        const createRes = await fetch(`/api/admin/vehicles`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...basePayload, picture_url: null }),
        });
        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Create failed (${createRes.status})`);
        }
        const { id } = (await createRes.json()) as { id?: string };
        if (id && pictureFile) {
          const uploadedPath = await uploadImageIfAny(id);
          if (uploadedPath) {
            await fetch(`/api/admin/vehicles/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ picture_url: uploadedPath }),
            }).catch(() => {});
          }
        }
        router.push("/operator-admin/vehicles");
        return;
      }

      // Update existing
      const payload = { ...basePayload };
      const uploadedPath = await uploadImageIfAny(vehicleId!);
      if (uploadedPath) payload.picture_url = uploadedPath;

      const res = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaving(false);
        return setMsg(body?.error || `Update failed (${res.status})`);
      }

      // Refresh preview if we uploaded one
      if (uploadedPath) {
        const resolved = await resolveImageUrl(uploadedPath);
        setStoredImageUrl(resolved);
        setPictureFile(null);
      }

      setMsg("Updated ✅");
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (isNew || !vehicleId) return;
    if (!confirm("Delete this vehicle?")) return;

    try {
      setDeleting(true);
      const res = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleting(false);
        return setMsg(body?.error || `Delete failed (${res.status})`);
      }
      router.push("/operator-admin/vehicles");
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
      setDeleting(false);
    }
  }

  const operatorName =
    (operatorLocked &&
      (psUser?.operator_name ||
        operators.find((o) => o.id === psUser?.operator_id)?.name)) ||
    "";

  /* ───────────────────── Captains & Priority (NEW) ───────────────────── */

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [assignments, setAssignments] = useState<SVA[]>([]);
  const [relMsg, setRelMsg] = useState<string | null>(null);
  const [addingStaffId, setAddingStaffId] = useState<string>("");
  const [addingPriority, setAddingPriority] = useState<number>(3);

  // staff options: operator's active staff with a lead role, excluding already assigned
  const staffOptions = useMemo(() => {
    const already = new Set(assignments.map((a) => a.staff_id));
    return staff
      .filter((s) => s.operator_id === operatorId && isLeadRole(s.jobrole))
      .filter((s) => !already.has(s.id))
      .sort((a, b) =>
        `${a.last_name || ""} ${a.first_name || ""}`.localeCompare(
          `${b.last_name || ""} ${b.first_name || ""}`
        )
      );
  }, [staff, assignments, operatorId]);

  // display join
  const staffById = useMemo(() => {
    const m = new Map<string, StaffRow>();
    staff.forEach((s) => m.set(s.id, s));
    return m;
  }, [staff]);

  async function loadRelationships(opId: string, vId: string) {
    if (!opId || !vId || isNew) {
      setAssignments([]);
      setStaff([]);
      return;
    }
    setRelMsg(null);
    const [{ data: sva }, { data: st }] = await Promise.all([
      sb
        .from("vehicle_staff_prefs")
        .select("id,operator_id,vehicle_id,staff_id,priority,is_lead_eligible,created_at")
        .eq("operator_id", opId)
        .eq("vehicle_id", vId)
        .order("priority", { ascending: true }),
      sb
        .from("operator_staff")
        .select("id,operator_id,first_name,last_name,jobrole,photo_url,active")
        .eq("operator_id", opId),
    ]);
    setAssignments((sva as SVA[]) || []);
    setStaff((st as StaffRow[]) || []);
  }

  useEffect(() => {
    if (operatorId && vehicleId) {
      loadRelationships(operatorId, vehicleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId, vehicleId]);

  async function addCaptain() {
    if (!operatorId || !vehicleId || !addingStaffId || isNew) return;
    setRelMsg(null);
    if (assignments.some((a) => a.staff_id === addingStaffId)) {
      setRelMsg("Already added.");
      return;
    }
    if (addingPriority < 1 || addingPriority > 5) {
      setRelMsg("Priority must be 1–5.");
      return;
    }
    const { error } = await sb.from("vehicle_staff_prefs").insert({
      operator_id: operatorId,
      vehicle_id: vehicleId,
      staff_id: addingStaffId,
      priority: addingPriority,
      is_lead_eligible: true,
    });
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAddingStaffId("");
    setAddingPriority(3);
    await loadRelationships(operatorId, vehicleId);
  }

  async function updatePriority(id: string, next: number) {
    if (next < 1 || next > 5) {
      setRelMsg("Priority must be 1–5.");
      return;
    }
    const { error } = await sb
      .from("vehicle_staff_prefs")
      .update({ priority: next })
      .eq("id", id);
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAssignments((prev) =>
      prev.map((r) => (r.id === id ? { ...r, priority: next } : r))
    );
  }

  async function toggleEligible(id: string, cur: boolean) {
    const { error } = await sb
      .from("vehicle_staff_prefs")
      .update({ is_lead_eligible: !cur })
      .eq("id", id);
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAssignments((prev) =>
      prev.map((r) => (r.id === id ? { ...r, is_lead_eligible: !cur } : r))
    );
  }

  async function removeRel(id: string) {
    if (!confirm("Remove this captain from this vehicle?")) return;
    const { error } = await sb
      .from("vehicle_staff_prefs")
      .delete()
      .eq("id", id);
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAssignments((prev) => prev.filter((r) => r.id !== id));
  }

  const sortedAssignments = useMemo(
    () =>
      [...assignments].sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : (staffById.get(a.staff_id)?.last_name || "").localeCompare(
              staffById.get(b.staff_id)?.last_name || ""
            )
      ),
    [assignments, staffById]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/operator-admin/vehicles"
          className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm"
        >
          ← Back
        </Link>
        {!isNew && (
          <button
            onClick={onDelete}
            className="rounded-full border px-3 py-2 text-sm"
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      <header>
        <h1 className="text-2xl font-semibold">
          {loading ? "Loading…" : isNew ? "New Vehicle" : "Edit Vehicle"}
        </h1>
      </header>

      {/* Preview image */}
      <section className="rounded-2xl border bg-white p-4 shadow">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-3">
            <div className="w-full rounded-2xl overflow-hidden border">
              {/* live preview takes precedence */}
              {livePreviewUrl ? (
                <img
                  src={livePreviewUrl}
                  alt="New upload preview"
                  className="w-full h-48 sm:h-60 object-cover"
                  style={{ objectPosition: "50% 40%" }}
                />
              ) : storedImageUrl ? (
                <img
                  src={storedImageUrl}
                  alt="Vehicle image"
                  className="w-full h-48 sm:h-60 object-cover"
                  style={{ objectPosition: "50% 40%" }}
                />
              ) : (
                <div className="w-full h-48 sm:h-60 grid place-items-center text-neutral-400">
                  No image
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="rounded-2xl border bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">
                Operator *
              </label>
              {operatorLocked ? (
                <div className="inline-flex rounded-full bg-neutral-100 border px-3 py-2 text-sm">
                  {operatorName || psUser?.operator_id}
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
              <label className="block text-sm text-neutral-600 mb-1">
                Transport Type *
              </label>
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
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Vehicle Name *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Min Seats *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="numeric"
                value={minSeats}
                onChange={(e) => setMinSeats(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Max Seats *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="numeric"
                value={maxSeats}
                onChange={(e) => setMaxSeats(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Min Value *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="decimal"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Min Value Threshold
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="decimal"
                value={minValThreshold}
                onChange={(e) => setMinValThreshold(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 mb-1">
              Description
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Picture
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPictureFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in bucket <code>images</code> at{" "}
                <code>vehicles/&lt;vehicleId&gt;/</code>
              </p>
            </div>

            <div className="flex items-end">
              <label className="inline-flex items-center gap-2">
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
            <Link
              href="/operator-admin/vehicles"
              className="inline-flex rounded-full px-4 py-2 border text-sm"
            >
              Cancel
            </Link>
            {msg && <span className="text-sm text-neutral-600">{msg}</span>}
          </div>
        </form>
      </section>

      {/* NEW: Captains & Priority */}
      {!isNew && (
        <section className="rounded-2xl border bg-white p-5 shadow space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Captains & Priority</h2>
            {relMsg && <span className="text-sm text-red-600">{relMsg}</span>}
          </div>

          {/* Add line */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border rounded-lg px-3 py-2"
              value={addingStaffId}
              onChange={(e) => setAddingStaffId(e.target.value)}
              disabled={!operatorId}
            >
              <option value="">Add captain…</option>
              {staffOptions.map((s) => {
                const name = `${s.last_name || ""} ${s.first_name || ""}`.trim() || "Unnamed";
                return (
                  <option key={s.id} value={s.id}>{name}</option>
                );
              })}
            </select>

            <label className="text-sm">Priority</label>
            <select
              className="border rounded-lg px-2 py-1"
              value={addingPriority}
              onChange={(e) => setAddingPriority(Number(e.target.value))}
            >
              {[1,2,3,4,5].map(n => <option key={n} value={n}>P{n}</option>)}
            </select>

            <button
              className="px-3 py-2 rounded border"
              disabled={!addingStaffId || !vehicleId || !operatorId}
              onClick={addCaptain}
              type="button"
            >
              Add
            </button>
          </div>

          {/* Current list */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Captain</th>
                  <th className="text-left p-3">Role</th>
                  <th className="text-left p-3">Priority</th>
                  <th className="text-left p-3">Lead-eligible</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAssignments.length === 0 ? (
                  <tr><td className="p-3" colSpan={5}>No captains linked to this vehicle yet.</td></tr>
                ) : (
                  sortedAssignments.map((r) => {
                    const st = staffById.get(r.staff_id);
                    const name = st
                      ? `${st.last_name || ""} ${st.first_name || ""}`.trim() || "Unnamed"
                      : `#${r.staff_id.slice(0,8)}`;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-3">{name}</td>
                        <td className="p-3">{st?.jobrole || "—"}</td>
                        <td className="p-3">
                          <select
                            className="border rounded px-2 py-1"
                            value={r.priority}
                            onChange={(e) => updatePriority(r.id, Number(e.target.value))}
                          >
                            {[1,2,3,4,5].map(n => <option key={n} value={n}>P{n}</option>)}
                          </select>
                        </td>
                        <td className="p-3">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={r.is_lead_eligible}
                              onChange={() => toggleEligible(r.id, r.is_lead_eligible)}
                            />
                            <span className="text-sm">{r.is_lead_eligible ? "Yes" : "No"}</span>
                          </label>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            className="px-3 py-1 rounded border"
                            onClick={() => removeRel(r.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
