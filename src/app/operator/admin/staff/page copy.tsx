

"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase (browser) for READS + Storage ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = {
  id: string;
  first_name?: string | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: string; name: string };
type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: string; journey_type_id: string };
type RoleRow = { type_id: string; name: string }; // optional table: transport_type_role
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
  type_id: string | null;
};

/* ---------- Image helpers (same method as other pages) ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;

  // 1) Try public URL (works if bucket/object is public)
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;

  // 2) Fallback to long-lived signed URL (works for private objects)
  const { data } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365); // 1 year
  return data?.signedUrl ?? null;
}

/* ---------- Component ---------- */
export default function OperatorStaffPage() {
  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);
  const opAdminName = psUser?.operator_name ?? "Your Operator";

  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]); // optional table

  /* Selected operator */
  const [operatorId, setOperatorId] = useState("");

  /* Rows */
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [loading, setLoading] = useState(true);

  /* Form */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [typeId, setTypeId] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [status, setStatus] = useState("Active");
  const [licenses, setLicenses] = useState("");
  const [notes, setNotes] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  /* UI */
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* Thumbs */
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});

  /* Read ps_user once and pre-select operator for operator admins */
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

  /* Derived: operator’s allowed type ids & types */
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
    () => journeyTypes.filter((jt) => allowedTypeIds.has(jt.id)),
    [journeyTypes, allowedTypeIds]
  );

  /* Default roles if table absent */
  const defaultRoles = ["Captain", "Crew", "Driver"];
  const roleOptionsForType = useMemo(() => {
    const list = roles.filter((r) => r.type_id === typeId).map((r) => r.name);
    return list.length ? list : defaultRoles;
  }, [roles, typeId]);

  /* Initial load (keep your existing behavior) */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);

      const [ops, jts, rels, staff] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
        sb.from("operator_staff").select("*").order("created_at", {
          ascending: false,
        }),
      ]);

      if (off) return;

      if (ops.data) setOperators(ops.data as Operator[]);
      if (jts.data) setJourneyTypes(jts.data as JourneyType[]);
      if (rels.data) setOpTypeRels(rels.data as OperatorTypeRel[]);
      if (staff.data) setRows(staff.data as StaffRow[]);

      // optional roles table
      const rolesRes = await sb
        .from("transport_type_role")
        .select("type_id,name");
      if (!rolesRes.error && rolesRes.data)
        setRoles(rolesRes.data as RoleRow[]);

      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* Build thumbnails (public URL first, signed fallback) */
  useEffect(() => {
    let off = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await resolveStorageUrl(r.photo_url || null)] as const)
      );
      if (!off) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      off = true;
    };
  }, [rows]);

  /* Filter table by operator + search */
  const filtered = useMemo(() => {
    const base = operatorId
      ? rows.filter((r) => r.operator_id === operatorId)
      : rows;
    const s = q.trim().toLowerCase();
    const typeName = (id: string | null) =>
      journeyTypes.find((t) => t.id === id)?.name ?? "";
    if (!s) return base;
    return base.filter(
      (r) =>
        r.first_name.toLowerCase().includes(s) ||
        r.last_name.toLowerCase().includes(s) ||
        typeName(r.type_id).toLowerCase().includes(s) ||
        (r.jobrole || "").toLowerCase().includes(s)
    );
  }, [rows, q, operatorId, journeyTypes]);

  function resetForm() {
    setEditingId(null);
    setTypeId("");
    setJobRole("");
    setFirst("");
    setLast("");
    setStatus("Active");
    setLicenses("");
    setNotes("");
    setPhotoFile(null);
    setMsg(null);
    // if operator admin, keep their operator preselected
    if (psUser?.operator_admin && psUser.operator_id) {
      setOperatorId(psUser.operator_id);
    }
  }

  async function reloadRows() {
    const { data, error } = await sb
      .from("operator_staff")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setMsg(error.message);
      return;
    }
    setRows((data as StaffRow[]) || []);
  }

  async function loadOne(id: string) {
    setMsg(null);
    const { data, error } = await sb
      .from("operator_staff")
      .select("*")
      .eq("id", id)
      .single();
    if (error || !data) {
      setMsg(error?.message ?? "Could not load staff.");
      return;
    }
    const s = data as StaffRow;
    setEditingId(id);
    setOperatorId(s.operator_id);
    setTypeId(s.type_id ?? "");
    setJobRole(s.jobrole ?? "");
    setFirst(s.first_name ?? "");
    setLast(s.last_name ?? "");
    setStatus(s.status ?? "Active");
    setLicenses(s.licenses ?? "");
    setNotes(s.notes ?? "");
    setPhotoFile(null);
    setMsg(`Editing: ${s.first_name} ${s.last_name}`);
  }

  async function uploadPhotoIfAny(staffId: string) {
    if (!photoFile) return null;
    const safe = photoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `staff/${staffId}/${Date.now()}-${safe}`; // same layout as other pages
    const { error } = await sb.storage
      .from("images")
      .upload(path, photoFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: photoFile.type || "image/*",
      });
    if (error) {
      setMsg(`Photo upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

  /* ---------- SAVE via API (to operator endpoints) ---------- */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);

      // For operator admins, operatorId is enforced from ps_user
      const effectiveOperatorId =
        isOpAdmin && psUser?.operator_id ? psUser.operator_id : operatorId;

      if (!effectiveOperatorId) return setMsg("Please choose an Operator.");
      if (!typeId) return setMsg("Please select a Vehicle Type.");
      if (!jobRole) return setMsg("Please select a Role.");
      if (!first.trim() || !last.trim())
        return setMsg("Please enter first and last name.");

      setSaving(true);

      if (!editingId) {
        // CREATE
        const payload = {
          operator_id: effectiveOperatorId, // your API accepts this and/or derives from auth
          type_id: typeId,
          jobrole: jobRole,
          first_name: first.trim(),
          last_name: last.trim(),
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

        setMsg("Created ✅");
        await reloadRows();
        resetForm();
      } else {
        // UPDATE
        const id = editingId;
        const path = await uploadPhotoIfAny(id);
        const payload: Record<string, any> = {
          operator_id: effectiveOperatorId,
          type_id: typeId,
          jobrole: jobRole,
          first_name: first.trim(),
          last_name: last.trim(),
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

  async function onRemove(row: StaffRow) {
    if (!confirm(`Delete staff "${row.first_name} ${row.last_name}"?`)) return;
    setMsg(null);
    setDeletingId(row.id);
    const res = await fetch(`/api/operator/staff/${row.id}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeletingId(null);
      return setMsg(body?.error || `Delete failed (${res.status})`);
    }
    if (editingId === row.id) resetForm();
    await reloadRows();
    setDeletingId(null);
    setMsg("Deleted.");
  }

  /* ---------- UI ---------- */
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Staff</h1>
        <p className="text-neutral-600">
          {isOpAdmin
            ? `Showing staff for ${opAdminName}.`
            : "Choose an Operator, then add/edit staff. Photos upload to Storage."}
        </p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Operator *</label>

              {isOpAdmin ? (
                <div className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm bg-neutral-50">
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                  {opAdminName}
                </div>
              ) : (
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={operatorId}
                  onChange={(e) => {
                    setOperatorId(e.target.value);
                    setTypeId("");
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
              <label className="block text-sm text-neutral-600 mb-1">Vehicle Type *</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setJobRole("");
                }}
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
                disabled={!typeId}
              >
                <option value="">— Select —</option>
                {roleOptionsForType.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
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
          </div>

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
                onChange={(e) => setPhotoFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in bucket <code>images</code> at <code>staff/&lt;staffId&gt;/</code>
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 mb-1">Notes</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={
                saving ||
                !operatorId ||
                !typeId ||
                !jobRole ||
                !first.trim() ||
                !last.trim()
              }
              className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update Staff" : "Create Staff"}
            </button>
            {editingId && (
              <button
                type="button"
                className="inline-flex rounded-full px-4 py-2 border text-sm"
                onClick={resetForm}
                disabled={saving}
              >
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
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Search staff…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : operatorId && filtered.length === 0 ? (
            <div className="p-4">No staff yet for this operator.</div>
          ) : !operatorId ? (
            <div className="p-4">
              {isOpAdmin
                ? "No operator is linked to this account."
                : "Choose an Operator to list staff."}
            </div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Photo</th>
                  <th className="text-left p-3">First Name</th>
                  <th className="text-left p-3">Last Name</th>
                  <th className="text-left p-3">Vehicle Type</th>
                  <th className="text-left p-3">Role</th>
                  <th className="text-left p-3">Active</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3" title={rows.find(x => x.id === r.id)?.photo_url ?? ""}>
                      {thumbs[r.id] ? (
                        <img
                          src={thumbs[r.id]!}
                          alt={`${r.first_name} ${r.last_name}`}
                          className="h-10 w-16 object-cover rounded border"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                          }}
                        />
                      ) : (
                        <div className="h-10 w-16 rounded border bg-neutral-100" />
                      )}
                    </td>
                    <td className="p-3">{r.first_name}</td>
                    <td className="p-3">{r.last_name}</td>
                    <td className="p-3">
                      {journeyTypes.find((t) => t.id === r.type_id)?.name ?? "—"}
                    </td>
                    <td className="p-3">{r.jobrole ?? "—"}</td>
                    <td className="p-3">{(r.status || "Active") === "Active" ? "Yes" : "No"}</td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        className="px-3 py-1 rounded-full border"
                        onClick={() => loadOne(r.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 rounded-full border"
                        onClick={() => onRemove(r)}
                        disabled={deletingId === r.id}
                      >
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
