"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Country = { id: string; name: string };
type JourneyType = { id: string; name: string };
type OperatorRow = {
  id: string;
  name: string | null;
  admin_email: string | null;
  phone: string | null;
  created_at: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  country_id: string | null;
  /** We store a STORAGE PATH here (e.g. "operators/<id>/<file>.jpg") */
  logo_url: string | null;
};
type OperatorTypeRel = { operator_id: string; journey_type_id: string };

/* ---------- Storage (match existing setup) ---------- */
const STORAGE_BUCKET = "images";          // <— IMPORTANT: your working bucket
const STORAGE_PREFIX = "operators";       // files under images/operators/<id>/...

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}
function isHttpUrl(s: string | null | undefined) {
  return !!s && /^https?:\/\//i.test(s);
}

/** Resolve storage path or raw URL into a browser-loadable URL.
 * Use a signed URL so it works with public or private buckets.
 */
async function resolveLogoUrl(pathOrUrl: string): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365); // 1 year
  if (error) return null;
  return data?.signedUrl ?? null;
}

export default function OperatorsPage() {
  /* Lookups */
  const [countries, setCountries] = useState<Country[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);

  /* Rows + relations */
  const [rows, setRows] = useState<OperatorRow[]>([]);
  const [rels, setRels] = useState<OperatorTypeRel[]>([]);
  const [loading, setLoading] = useState(true);

  /* Form state */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [countryId, setCountryId] = useState("");
  const [name, setName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [town, setTown] = useState("");
  const [region, setRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [journeyTypeIds, setJourneyTypeIds] = useState<string[]>([]);

  /* UI */
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* Map of row.id -> resolved logo URL */
  const [logoUrlMap, setLogoUrlMap] = useState<Record<string, string | null>>({});

  const countryName = (id: string | null | undefined) =>
    countries.find((c) => c.id === id)?.name ?? "";

  const servicesFor = (opId: string) =>
    rels
      .filter((r) => r.operator_id === opId)
      .map((r) => journeyTypes.find((jt) => jt.id === r.journey_type_id)?.name)
      .filter(Boolean)
      .join(", ") || "—";

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        (r.name || "").toLowerCase().includes(s) ||
        (r.admin_email || "").toLowerCase().includes(s) ||
        (r.phone || "").toLowerCase().includes(s) ||
        countryName(r.country_id).toLowerCase().includes(s) ||
        servicesFor(r.id).toLowerCase().includes(s)
    );
  }, [rows, q, countries, rels, journeyTypes]);

  /* Initial load */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [c, jt, ops, ot] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operators").select("*").order("created_at", { ascending: false }),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);
      if (off) return;

      if (c.error || jt.error || ops.error || ot.error) {
        setMsg(
          c.error?.message ||
            jt.error?.message ||
            ops.error?.message ||
            ot.error?.message ||
            "Load failed"
        );
      }

      const rows = (ops.data as OperatorRow[]) || [];
      setCountries((c.data as Country[]) || []);
      setJourneyTypes((jt.data as JourneyType[]) || []);
      setRows(rows);
      setRels((ot.data as OperatorTypeRel[]) || []);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  /* Resolve logos on row changes */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, r.logo_url ? await resolveLogoUrl(r.logo_url) : null] as const)
      );
      if (!cancelled) setLogoUrlMap(Object.fromEntries(entries));
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  async function reloadAll() {
    const [ops, ot] = await Promise.all([
      sb.from("operators").select("*").order("created_at", { ascending: false }),
      sb.from("operator_transport_types").select("operator_id,journey_type_id"),
    ]);
    if (ops.error || ot.error) {
      setMsg(ops.error?.message || ot.error?.message || "Reload failed");
      return;
    }
    setRows((ops.data as OperatorRow[]) || []);
    setRels((ot.data as OperatorTypeRel[]) || []);
  }

  function resetForm() {
    setEditingId(null);
    setCountryId("");
    setName("");
    setAdminEmail("");
    setPhone("");
    setAddress1("");
    setAddress2("");
    setTown("");
    setRegion("");
    setPostalCode("");
    setLogoFile(null);
    setJourneyTypeIds([]);
    setMsg(null);
  }

  function toggleJourneyType(id: string) {
    setJourneyTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function loadOne(id: string) {
    setMsg(null);
    const [{ data, error }, { data: relData, error: relErr }] = await Promise.all([
      sb.from("operators").select("*").eq("id", id).single(),
      sb.from("operator_transport_types").select("journey_type_id").eq("operator_id", id),
    ]);
    if (error || !data) {
      setMsg(error?.message ?? "Could not load operator.");
      return;
    }
    if (relErr) {
      setMsg(relErr.message);
      return;
    }
    setEditingId(id);
    setCountryId(data.country_id ?? "");
    setName(data.name ?? "");
    setAdminEmail(data.admin_email ?? "");
    setPhone(data.phone ?? "");
    setAddress1(data.address1 ?? "");
    setAddress2(data.address2 ?? "");
    setTown(data.town ?? "");
    setRegion(data.region ?? "");
    setPostalCode(data.postal_code ?? "");
    setLogoFile(null);
    setJourneyTypeIds((relData as OperatorTypeRel[] | null)?.map((r) => r.journey_type_id) ?? []);
    setMsg(`Editing: ${data.name || id}`);
  }

  /** Upload the file and return the STORAGE PATH (not URL). */
  async function uploadLogoIfAny(operatorId: string): Promise<string | null> {
    if (!logoFile) return null;
    const safeName = logoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `${STORAGE_PREFIX}/${operatorId}/${Date.now()}-${safeName}`;

    const { error: upErr } = await sb.storage
      .from(STORAGE_BUCKET) // images
      .upload(path, logoFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: logoFile.type || "image/*",
      });

    if (upErr) {
      setMsg(`Logo upload failed: ${upErr.message}`);
      return null;
    }
    return path; // store as path
  }

  /* ---------- SAVE ---------- */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);

      if (!countryId || !name.trim()) {
        setMsg("Please provide Country and Operator name.");
        return;
      }
      if (!editingId && journeyTypeIds.length === 0) {
        setMsg("Please select at least one Service.");
        return;
      }

      setSaving(true);

      if (!editingId) {
        // CREATE
        const payload = {
          country_id: countryId,
          name: name.trim(),
          admin_email: adminEmail.trim() || null,
          phone: phone.trim() || null,
          address1: address1.trim() || null,
          address2: address2.trim() || null,
          town: town.trim() || null,
          region: region.trim() || null,
          postal_code: postalCode.trim() || null,
          journey_type_ids: journeyTypeIds,
        };

        const res = await fetch(`/api/admin/operators`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          setMsg(body?.error || `Create failed (${res.status})`);
          return;
        }

        const { id } = await res.json();

        // Upload logo and PATCH the path into logo_url
        if (id && logoFile) {
          const path = await uploadLogoIfAny(id);
          if (path) {
            const patch = await fetch(`/api/admin/operators/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ logo_url: path }),
            });
            if (!patch.ok) {
              const body = await patch.json().catch(() => ({}));
              setMsg(body?.error || `Logo save failed (${patch.status})`);
            }
          }
        }

        setMsg("Created ✅");
        await reloadAll();
        resetForm();
      } else {
        // UPDATE
        const id = editingId;
        const path = await uploadLogoIfAny(id);

        const payload: Record<string, any> = {
          country_id: countryId,
          name: name.trim(),
          admin_email: adminEmail.trim() || null,
          phone: phone.trim() || null,
          address1: address1.trim() || null,
          address2: address2.trim() || null,
          town: town.trim() || null,
          region: region.trim() || null,
          postal_code: postalCode.trim() || null,
          journey_type_ids: journeyTypeIds,
        };
        if (path) payload.logo_url = path;

        const res = await fetch(`/api/admin/operators/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          setMsg(body?.error || `Update failed (${res.status})`);
          return;
        }

        setMsg("Updated ✅");
        await reloadAll();
        resetForm();
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(row: OperatorRow) {
    if (!confirm(`Delete operator "${row.name || "this operator"}"?`)) return;
    setMsg(null);
    setDeletingId(row.id);

    const res = await fetch(`/api/admin/operators/${row.id}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeletingId(null);
      setMsg(body?.error || `Delete failed (${res.status})`);
      return;
    }

    await reloadAll();
    setDeletingId(null);
    setMsg("Deleted.");
    if (editingId === row.id) resetForm();
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Operators</h1>
        <p className="text-neutral-600">Create, edit and delete Operators. Upload logos and assign services.</p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          {/* Country + Name */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Country *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
                <option value="">— Select —</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Operator Name *</label>
              <input className="w-full border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Island Fast Boats" />
            </div>
          </div>

          {/* Contact */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Admin Email</label>
              <input type="email" className="w-full border rounded-lg px-3 py-2" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Phone</label>
              <input className="w-full border rounded-lg px-3 py-2" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {/* Address */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Address line 1</label>
              <input className="w-full border rounded-lg px-3 py-2" value={address1} onChange={(e) => setAddress1(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Address line 2</label>
              <input className="w-full border rounded-lg px-3 py-2" value={address2} onChange={(e) => setAddress2(e.target.value)} />
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Town</label>
              <input className="w-full border rounded-lg px-3 py-2" value={town} onChange={(e) => setTown(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Region / State</label>
              <input className="w-full border rounded-lg px-3 py-2" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Postal Code</label>
              <input className="w-full border rounded-lg px-3 py-2" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
            </div>
          </div>

          {/* Logo + Services */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Logo</label>
              <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in bucket <code>{STORAGE_BUCKET}</code> at <code>{STORAGE_PREFIX}/&lt;operatorId&gt;/</code>
              </p>
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Services (Transport Types){editingId ? "" : " *"}</label>
              <div className="flex flex-wrap gap-2">
                {journeyTypes.map((jt) => (
                  <label
                    key={jt.id}
                    className={cls(
                      "inline-flex items-center gap-2 border rounded-full px-3 py-1 cursor-pointer",
                      journeyTypeIds.includes(jt.id) && "bg-black text-white border-black"
                    )}
                  >
                    <input type="checkbox" className="hidden" checked={journeyTypeIds.includes(jt.id)} onChange={() => toggleJourneyType(jt.id)} />
                    <span className="text-sm">{jt.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !countryId || !name.trim() || (!editingId && journeyTypeIds.length === 0)}
              className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update Operator" : "Create Operator"}
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

      {/* List */}
      <section className="space-y-3">
        <div className="flex gap-2">
          <input className="border rounded-lg px-3 py-2" placeholder="Search operators…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No operators yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Operator</th>
                  <th className="text-left p-3">Country</th>
                  <th className="text-left p-3">Logo</th>
                  <th className="text-left p-3">Services</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3">
                      <button className="px-2 py-1 rounded-full border" onClick={() => loadOne(r.id)} title="Edit">
                        {r.name || "—"}
                      </button>
                    </td>
                    <td className="p-3">{countryName(r.country_id)}</td>
                    <td className="p-3">
                      {logoUrlMap[r.id] ? (
                        <img src={logoUrlMap[r.id]!} alt={r.name || "logo"} className="h-10 w-16 object-cover rounded border" />
                      ) : (
                        <div className="h-10 w-16 rounded border bg-neutral-100" />
                      )}
                    </td>
                    <td className="p-3">{servicesFor(r.id)}</td>
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