"use client";

import { useRouter, useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
// DEBUG ONLY: expose to console so we can inspect the JWT/session
;(globalThis as any).sb = sb;


/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
  site_admin?: boolean | null;
};

type Operator = { id: string; name: string };
type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: string; journey_type_id: string };

type StaffRow = {
  id: string;
  operator_id: string;
  first_name: string;
  last_name: string;
  status: string | null;
  photo_url: string | null;
  licenses: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
  jobrole: string | null;
  type_id: string | null;        // legacy single
  type_ids: string[] | null;     // NEW multi
  pronoun: "he" | "she" | "they" | null;
  email: string | null;
};

type VehicleRow = {
  id: string;
  name: string;
  operator_id: string | null;
};

type SVA = {
  id: string;
  operator_id: string;
  vehicle_id: string;
  staff_id: string;
  priority: number; // 1..5
  is_lead_eligible: boolean;
};

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function leadRoleForTypeName(name: string): "Pilot" | "Driver" | "Captain" {
  const n = name.toLowerCase();
  if (n.includes("heli")) return "Pilot";
  if (n.includes("bus") || n.includes("limo")) return "Driver";
  return "Captain";
}

function roleOptionsForTypes(selectedTypeIds: string[], journeyTypes: JourneyType[]) {
  const names = selectedTypeIds
    .map((id) => journeyTypes.find((t) => t.id === id)?.name || "")
    .filter(Boolean);
  const leadRoles = new Set(names.map(leadRoleForTypeName));
  return Array.from(new Set<string>([...leadRoles, "Crew", "Admin"]));
}

/* ===================================================================== */

export default function EditStaffPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = params.id === "new";

  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);

  /* lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  /* form state */
  const [staffId, setStaffId] = useState<string | null>(null);
  const [operatorId, setOperatorId] = useState("");
  const [typeIds, setTypeIds] = useState<string[]>([]);
  const [jobRole, setJobRole] = useState("");
  const [pronoun, setPronoun] = useState<"he" | "she" | "they">("they");
  const [status, setStatus] = useState("Active");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [licenses, setLicenses] = useState("");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  /* ui */
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  /* derived: allowed types for selected operator */
  const allowedTypes = useMemo(() => {
    if (!operatorId) return [] as JourneyType[];
    const allowed = new Set(
      opTypeRels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id)
    );
    return journeyTypes.filter((t) => allowed.has(t.id));
  }, [operatorId, opTypeRels, journeyTypes]);

  /* load lookups + existing row (if editing) */
  useEffect(() => {
    let off = false;
    (async () => {
      const [ops, jts, rels] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);
      if (off) return;
      if (ops.data) setOperators(ops.data as Operator[]);
      if (jts.data) setJourneyTypes(jts.data as JourneyType[]);
      if (rels.data) setOpTypeRels(rels.data as OperatorTypeRel[]);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* if editing, load row */
  useEffect(() => {
    if (isNew) {
      // operator lock for op-admins
      if (isOpAdmin && psUser?.operator_id) setOperatorId(psUser.operator_id);
      return;
    }
    let off = false;
    (async () => {
      const { data, error } = await sb.from("operator_staff").select("*").eq("id", params.id).single();
      if (off) return;
      if (error || !data) {
        setMsg(error?.message ?? "Could not load staff.");
        return;
      }
      const s = data as StaffRow;
      setStaffId(s.id);
      setOperatorId(s.operator_id);
      const arr = s.type_ids && s.type_ids.length ? s.type_ids : (s.type_id ? [s.type_id] : []);
      setTypeIds(arr);
      setJobRole(s.jobrole ?? "");
      setPronoun((s.pronoun as any) || "they");
      setStatus(s.status ?? "Active");
      setFirst(s.first_name ?? "");
      setLast(s.last_name ?? "");
      setEmail(s.email ?? "");
      setLicenses(s.licenses ?? "");
      setNotes(s.notes ?? "");
      setPhotoUrl(await resolveStorageUrl(s.photo_url || null));
      setMsg(`Editing: ${s.first_name} ${s.last_name}`);
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, isNew]);

  /* auto-select single type if only one allowed for operator */
  useEffect(() => {
    if (!operatorId) return;
    const allowed = allowedTypes.map((t) => t.id);
    if (allowed.length === 1) {
      setTypeIds((prev) => (prev.length ? prev : [allowed[0]]));
    } else {
      setTypeIds((prev) => prev.filter((id) => allowed.includes(id)));
    }
  }, [operatorId, allowedTypes]);

  const lockedOperatorName =
    isOpAdmin && psUser?.operator_id
      ? psUser?.operator_name ||
        operators.find((o) => o.id === psUser.operator_id)?.name ||
        psUser.operator_id
      : "";

  async function uploadPhotoIfAny(id: string) {
    if (!photoFile) return null;
    const safe = photoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `staff/${id}/${Date.now()}-${safe}`;
    const { error } = await sb.storage
      .from("images")
      .upload(path, photoFile, { cacheControl: "3600", upsert: true, contentType: photoFile.type || "image/*" });
    if (error) {
      setMsg(`Photo upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);

      const effectiveOperatorId =
        isOpAdmin && psUser?.operator_id ? psUser.operator_id : operatorId;

      if (!effectiveOperatorId) return setMsg("Please choose an Operator.");
      if (typeIds.length === 0) return setMsg("Please select at least one Vehicle Type.");
      if (!jobRole) return setMsg("Please select a Role.");
      if (!first.trim() || !last.trim()) return setMsg("Please enter first and last name.");

      setSaving(true);

      if (isNew) {
        // CREATE
        const payload = {
          operator_id: effectiveOperatorId,
          type_id: typeIds[0] || null,   // legacy single
          type_ids: typeIds,             // NEW multi
          jobrole: jobRole,
          pronoun,
          first_name: first.trim(),
          last_name: last.trim(),
          email: email.trim() || null,   // NEW
          status,
          licenses: licenses.trim() || null,
          notes: notes.trim() || null,
          photo_url: null as string | null,
        };
        const res = await fetch("/api/operator/staff", {
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

        if (id && photoFile) {
          const path = await uploadPhotoIfAny(id);
          if (path) {
            const patch = await fetch(`/api/operator/staff/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ photo_url: path }),
            });
            if (!patch.ok) {
              const body = await patch.json().catch(() => ({}));
              setMsg(body?.error || `Photo save failed (${patch.status})`);
            }
          }
        }

        setSaving(false);
        router.push("/operator-admin/staff");
      } else {
        // UPDATE
        const id = staffId || (params.id as string);
        const path = await uploadPhotoIfAny(id);
        const payload: Record<string, any> = {
          operator_id: effectiveOperatorId,
          type_id: typeIds[0] || null,
          type_ids: typeIds,
          jobrole: jobRole,
          pronoun,
          first_name: first.trim(),
          last_name: last.trim(),
          email: email.trim() || null,
          status,
          licenses: licenses.trim() || null,
          notes: notes.trim() || null,
        };
        if (path) payload.photo_url = path;

        const res = await fetch(`/api/operator/staff/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Update failed (${res.status})`);
        }

        setSaving(false);
        router.push("/operator-admin/staff");
      }
    } catch (err: any) {
      setSaving(false);
      setMsg(err?.message ?? String(err));
    }
  }

  async function onDelete() {
    if (isNew) return;
    if (!confirm("Delete this staff member?")) return;
    try {
      setDeleting(true);
      const id = staffId || (params.id as string);
      const res = await fetch(`/api/operator/staff/${id}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleting(false);
        return setMsg(body?.error || `Delete failed (${res.status})`);
      }
      setDeleting(false);
      router.push("/operator-admin/staff");
    } catch (err: any) {
      setDeleting(false);
      setMsg(err?.message ?? String(err));
    }
  }

  const roleChoices = roleOptionsForTypes(typeIds, journeyTypes);

  /* ─────────────── Vehicle Eligibility (NEW) ─────────────── */
  const [vehMsg, setVehMsg] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [rels, setRels] = useState<SVA[]>([]);
  const [addVehId, setAddVehId] = useState<string>("");
  const [addPriority, setAddPriority] = useState<number>(3);

  const relByVeh = useMemo(() => {
    const m = new Map<string, SVA>();
    rels.forEach((r) => m.set(r.vehicle_id, r));
    return m;
  }, [rels]);

  const addOptions = useMemo(() => {
    // operator's vehicles not already linked
    const linked = new Set(rels.map((r) => r.vehicle_id));
    return vehicles
      .filter((v) => v.operator_id === operatorId && !linked.has(v.id))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [vehicles, rels, operatorId]);

  async function loadEligibility(opId: string, stId?: string | null) {
    if (!opId || !stId) {
      setVehicles([]);
      setRels([]);
      return;
    }
    setVehMsg(null);
    const [{ data: vs }, { data: rs }] = await Promise.all([
      sb.from("vehicles").select("id,name,operator_id").eq("operator_id", opId).order("name"),
      sb
        .from("vehicle_staff_prefs")
        .select("id,operator_id,vehicle_id,staff_id,priority,is_lead_eligible")
        .eq("operator_id", opId)
        .eq("staff_id", stId)
        .order("priority", { ascending: true }),
    ]);
    setVehicles((vs as VehicleRow[]) || []);
    setRels((rs as SVA[]) || []);
  }

  useEffect(() => {
    if (operatorId && (staffId || (!isNew && params.id))) {
      loadEligibility(operatorId, staffId || (params.id as string));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId, staffId, isNew, params.id]);

  async function addVehicleRel() {
    const stId = staffId || (params.id as string);
    if (!operatorId || !stId || !addVehId) return;
    setVehMsg(null);
    if (relByVeh.has(addVehId)) {
      setVehMsg("Already assigned to this vehicle.");
      return;
    }
    if (addPriority < 1 || addPriority > 5) {
      setVehMsg("Priority must be 1–5.");
      return;
    }
    const { error } = await sb.from("vehicle_staff_prefs").insert({
      operator_id: operatorId,
      vehicle_id: addVehId,
      staff_id: stId,
      priority: addPriority,
      is_lead_eligible: true,
    });
    if (error) {
      setVehMsg(error.message);
      return;
    }
    setAddVehId("");
    setAddPriority(3);
    await loadEligibility(operatorId, stId);
  }

  async function updateRelPriority(id: string, next: number) {
    if (next < 1 || next > 5) {
      setVehMsg("Priority must be 1–5.");
      return;
    }
    const { error } = await sb
      .from("vehicle_staff_prefs")
      .update({ priority: next })
      .eq("id", id);
    if (error) {
      setVehMsg(error.message);
      return;
    }
    setRels((prev) => prev.map((r) => (r.id === id ? { ...r, priority: next } : r)));
  }

  async function toggleRelEligible(id: string, cur: boolean) {
    const { error } = await sb
      .from("vehicle_staff_prefs")
      .update({ is_lead_eligible: !cur })
      .eq("id", id);
    if (error) {
      setVehMsg(error.message);
      return;
    }
    setRels((prev) => prev.map((r) => (r.id === id ? { ...r, is_lead_eligible: !cur } : r)));
  }

  async function removeRel(id: string) {
    if (!confirm("Remove this vehicle eligibility?")) return;
    const { error } = await sb.from("vehicle_staff_prefs").delete().eq("id", id);
    if (error) {
      setVehMsg(error.message);
      return;
    }
    setRels((prev) => prev.filter((r) => r.id !== id));
  }

  const sortedRels = useMemo(
    () =>
      [...rels].sort((a, b) =>
        a.priority !== b.priority ? a.priority - b.priority : 0
      ),
    [rels]
  );

  return (
    <div className="p-4 space-y-5">
      <div className="flex items-center gap-2">
        <button
          className="rounded-full border px-3 py-1.5 text-sm"
          onClick={() => router.push("/operator-admin/staff")}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">{isNew ? "New Staff" : "Edit Staff"}</h1>
        {!isNew && (
          <button
            className="ml-auto rounded-full border px-3 py-1.5 text-sm"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      {msg && <div className="text-sm text-red-600">{msg}</div>}

      <section className="rounded-2xl border bg-white p-5 shadow space-y-5">
        <form onSubmit={onSave} className="space-y-5">
          {/* Operator + Types + Role */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Operator *</label>
              {isOpAdmin ? (
                <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  {lockedOperatorName}
                </div>
              ) : (
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={operatorId}
                  onChange={(e) => {
                    setOperatorId(e.target.value);
                    setTypeIds([]);
                    setJobRole("");
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
                Vehicle Type{allowedTypes.length > 1 ? "s" : ""} *
              </label>
              <div
                className={cls(
                  "flex flex-wrap gap-2",
                  !operatorId && "opacity-50 pointer-events-none"
                )}
              >
                {allowedTypes.map((t) => {
                  const active = typeIds.includes(t.id);
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() =>
                        setTypeIds((prev) =>
                          active ? prev.filter((x) => x !== t.id) : [...prev, t.id]
                        )
                      }
                      className={cls(
                        "px-3 py-1 rounded-full border text-sm",
                        active ? "bg-black text-white border-black" : "bg-white"
                      )}
                    >
                      {t.name}
                    </button>
                  );
                })}
              </div>
              {!operatorId && (
                <p className="text-xs text-neutral-500 mt-1">
                  Choose an Operator to see allowed types.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Role *</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={jobRole}
                onChange={(e) => setJobRole(e.target.value)}
                disabled={typeIds.length === 0}
              >
                <option value="">— Select —</option>
                {roleChoices.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Status + Pronoun + Names + Email */}
          <div className="grid md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Status</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
                <option value="OnLeave">OnLeave</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Pronoun *</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={pronoun}
                onChange={(e) => setPronoun(e.target.value as any)}
              >
                <option value="he">he</option>
                <option value="she">she</option>
                <option value="they">they</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">First Name *</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={first}
                onChange={(e) => setFirst(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Last Name *</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={last}
                onChange={(e) => setLast(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Email</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                type="email"
                placeholder="captain@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-neutral-500 mt-1">Used for automated captain emails.</p>
            </div>
          </div>

          {/* Licenses + Photo */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Licenses / Certs</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={licenses}
                onChange={(e) => setLicenses(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Photo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setPhotoFile(f);
                  if (f) setPhotoUrl(URL.createObjectURL(f));
                }}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in <code>images/staff/&lt;staffId&gt;/</code>
              </p>
            </div>
          </div>

          {/* Preview */}
          {photoUrl && (
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Preview</label>
              <div className="h-36 w-56 border rounded overflow-hidden bg-neutral-50">
                <img src={photoUrl} alt="preview" className="h-full w-full object-cover object-center" />
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm text-neutral-600 mb-1">Notes</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={
                saving ||
                !(isOpAdmin ? true : !!operatorId) ||
                typeIds.length === 0 ||
                !jobRole ||
                !first.trim() ||
                !last.trim()
              }
              className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : isNew ? "Create Staff" : "Update Staff"}
            </button>
            <button
              type="button"
              className="inline-flex rounded-full px-4 py-2 border text-sm"
              onClick={() => router.push("/operator-admin/staff")}
              disabled={saving}
            >
              Cancel
            </button>
            {msg && <span className="text-sm text-neutral-600">{msg}</span>}
          </div>
        </form>
      </section>

      {/* NEW: Vehicle Eligibility */}
      {!isNew && (
        <section className="rounded-2xl border bg-white p-5 shadow space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Vehicle Eligibility</h2>
            {vehMsg && <span className="text-sm text-red-600">{vehMsg}</span>}
          </div>

          {/* Add line */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border rounded-lg px-3 py-2"
              value={addVehId}
              onChange={(e) => setAddVehId(e.target.value)}
              disabled={!operatorId}
            >
              <option value="">Add vehicle…</option>
              {addOptions.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>

            <label className="text-sm">Priority</label>
            <select
              className="border rounded-lg px-2 py-1"
              value={addPriority}
              onChange={(e) => setAddPriority(Number(e.target.value))}
            >
              {[1,2,3,4,5].map(n => <option key={n} value={n}>P{n}</option>)}
            </select>

            <button
              className="px-3 py-2 rounded border"
              disabled={!addVehId || !operatorId}
              onClick={addVehicleRel}
              type="button"
            >
              Add
            </button>
          </div>

          {/* Current relations */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Vehicle</th>
                  <th className="text-left p-3">Priority</th>
                  <th className="text-left p-3">Lead-eligible</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRels.length === 0 ? (
                  <tr><td className="p-3" colSpan={4}>No vehicles linked yet.</td></tr>
                ) : (
                  sortedRels.map((r) => {
                    const v = vehicles.find((x) => x.id === r.vehicle_id);
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-3">{v?.name || `#${r.vehicle_id.slice(0,8)}`}</td>
                        <td className="p-3">
                          <select
                            className="border rounded px-2 py-1"
                            value={r.priority}
                            onChange={(e) => updateRelPriority(r.id, Number(e.target.value))}
                          >
                            {[1,2,3,4,5].map(n => <option key={n} value={n}>P{n}</option>)}
                          </select>
                        </td>
                        <td className="p-3">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={r.is_lead_eligible}
                              onChange={() => toggleRelEligible(r.id, r.is_lead_eligible)}
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
