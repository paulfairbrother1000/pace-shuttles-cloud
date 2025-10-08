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

/* ---------- Img helpers ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function StaffEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = !params?.id || params.id === "new";

  /* ps_user */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isOpAdmin = Boolean(psUser?.operator_admin && psUser?.operator_id);

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
  const [rels, setRels] = useState<OperatorTypeRel[]>([]);

  /* Form */
  const [editingId, setEditingId] = useState<string | null>(isNew ? null : params.id);
  const [operatorId, setOperatorId] = useState<string>("");
  const [typeId, setTypeId] = useState<string>("");
  const [jobRole, setJobRole] = useState<string>("");
  const [first, setFirst] = useState<string>("");
  const [last, setLast] = useState<string>("");
  const [status, setStatus] = useState<string>("Active");
  const [licenses, setLicenses] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  /* Load lookups + record */
  useEffect(() => {
    let off = false;
    (async () => {
      const [ops, jts, ot] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);
      if (ops.error || jts.error || ot.error) {
        setMsg(
          ops.error?.message ||
            jts.error?.message ||
            ot.error?.message ||
            "Load failed"
        );
      }
      if (off) return;
      setOperators((ops.data as Operator[]) || []);
      setJourneyTypes((jts.data as JourneyType[]) || []);
      setRels((ot.data as OperatorTypeRel[]) || []);

      if (isNew) {
        // preselect operator for op-admins
        if (isOpAdmin && psUser?.operator_id) setOperatorId(psUser.operator_id);
        setLoading(false);
        return;
      }

      const { data, error } = await sb
        .from("operator_staff")
        .select("*")
        .eq("id", params.id)
        .single();

      if (error || !data) {
        setMsg(error?.message || "Could not load staff.");
        setLoading(false);
        return;
      }

      const s = data as StaffRow;
      setEditingId(s.id);
      setOperatorId(s.operator_id);
      setTypeId(s.type_id ?? "");
      setJobRole(s.jobrole ?? "");
      setFirst(s.first_name ?? "");
      setLast(s.last_name ?? "");
      setStatus(s.status ?? "Active");
      setLicenses(s.licenses ?? "");
      setNotes(s.notes ?? "");
      setPreviewUrl(await resolveStorageUrl(s.photo_url));
      setLoading(false);
    })();
    return () => { off = true; };
  }, [isNew, params?.id, isOpAdmin, psUser?.operator_id]);

  /* Allowed types for selected operator */
  const allowedTypeIds = useMemo(
    () => new Set(rels.filter((r) => r.operator_id === operatorId).map((r) => r.journey_type_id)),
    [rels, operatorId]
  );
  const allowedTypes = useMemo(
    () => journeyTypes.filter((jt) => allowedTypeIds.has(jt.id)),
    [journeyTypes, allowedTypeIds]
  );

  async function uploadPhotoIfAny(staffId: string) {
    if (!photoFile) return null;
    const safe = photoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `staff/${staffId}/${Date.now()}-${safe}`;
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
      if (!typeId) return setMsg("Please select a Vehicle Type.");
      if (!jobRole) return setMsg("Please select a Role.");
      if (!first.trim() || !last.trim()) return setMsg("Please enter first and last name.");

      setSaving(true);

      if (!editingId) {
        // CREATE
        const payload = {
          operator_id: effectiveOperatorId,
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
            await fetch(`/api/operator/staff/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ photo_url: path }),
            });
          }
        }
        router.push("/operator-admin/staff");
      } else {
        // UPDATE
        const id = editingId;
        const toUpdate: Record<string, any> = {
          operator_id: effectiveOperatorId,
          type_id: typeId,
          jobrole: jobRole,
          first_name: first.trim(),
          last_name: last.trim(),
          status,
          licenses: licenses.trim() || null,
          notes: notes.trim() || null,
        };
        if (photoFile) {
          const path = await uploadPhotoIfAny(id);
          if (path) toUpdate.photo_url = path;
        }
        const res = await fetch(`/api/operator/staff/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(toUpdate),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Update failed (${res.status})`);
        }
        router.push("/operator-admin/staff");
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (!confirm("Delete this staff member?")) return;
    const res = await fetch(`/api/operator/staff/${editingId}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setMsg(body?.error || `Delete failed (${res.status})`);
    }
    router.push("/operator-admin/staff");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/operator-admin/staff" className="rounded-full px-3 py-1 border text-sm">
          ← Back
        </Link>
        <h1 className="text-2xl font-semibold">{isNew ? "New Staff" : "Edit Staff"}</h1>
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
                {isOpAdmin ? (
                  <div className="rounded-full border px-3 py-2 text-sm bg-neutral-50">
                    {psUser?.operator_name ?? psUser?.operator_id}
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
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block text-sm text-neutral-600 mb-1">Vehicle Type *</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                  disabled={!operatorId && !isOpAdmin}
                >
                  <option value="">— Select —</option>
                  {allowedTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm text-neutral-600 mb-1">Role *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  placeholder="e.g., Captain"
                  value={jobRole}
                  onChange={(e) => setJobRole(e.target.value)}
                />
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
                <input className="w-full border rounded-lg px-3 py-2" value={first} onChange={(e) => setFirst(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Last Name *</label>
                <input className="w-full border rounded-lg px-3 py-2" value={last} onChange={(e) => setLast(e.target.value)} />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Licenses / Certs</label>
                <input className="w-full border rounded-lg px-3 py-2" value={licenses} onChange={(e) => setLicenses(e.target.value)} />
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    setPhotoFile(f);
                    setPreviewUrl(f ? URL.createObjectURL(f) : previewUrl);
                  }}
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Stored in <code>images/staff/&lt;staffId&gt;/</code>
                </p>
              </div>
            </div>

            {previewUrl && (
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Preview</label>
                <div className="h-36 w-36 border rounded overflow-hidden">
                  <img src={previewUrl} alt="preview" className="h-full w-full object-cover" />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Notes</label>
              <textarea className="w-full border rounded-lg px-3 py-2" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={
                  saving ||
                  (!isOpAdmin && !operatorId) ||
                  !typeId ||
                  !jobRole ||
                  !first.trim() ||
                  !last.trim()
                }
                className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
              >
                {saving ? "Saving…" : editingId ? "Update Staff" : "Create Staff"}
              </button>
              <Link href="/operator-admin/staff" className="inline-flex rounded-full px-4 py-2 border text-sm">
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
