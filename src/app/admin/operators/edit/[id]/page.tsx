// src/app/admin/operators/edit/[id]/page.tsx

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
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
  /** STORAGE PATH */
  logo_url: string | null;
};
type OperatorTypeRel = { operator_id: string; journey_type_id: string };

/* ---------- Storage helpers ---------- */
const STORAGE_BUCKET = "images";
const STORAGE_PREFIX = "operators";
function isHttpUrl(s: string | null | undefined) {
  return !!s && /^https?:\/\//i.test(s);
}
async function resolveLogoUrl(pathOrUrl: string): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttpUrl(pathOrUrl)) return pathOrUrl;
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  if (error) return null;
  return data?.signedUrl ?? null;
}
function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export default function OperatorEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = !params?.id || params.id === "new";

  /* Lookups */
  const [countries, setCountries] = useState<Country[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);

  /* Form state */
  const [editingId, setEditingId] = useState<string | null>(isNew ? null : params.id);
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
  const [existingLogoPath, setExistingLogoPath] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [journeyTypeIds, setJourneyTypeIds] = useState<string[]>([]);

  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  /* Load lookups + record */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [c, jt] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
      ]);
      if (off) return;
      if (c.error || jt.error) {
        setMsg(c.error?.message || jt.error?.message || "Load failed");
      }
      setCountries((c.data as Country[]) || []);
      setJourneyTypes((jt.data as JourneyType[]) || []);

      if (!isNew) {
        const [{ data, error }, { data: relData, error: relErr }] = await Promise.all([
          sb.from("operators").select("*").eq("id", params.id).single(),
          sb.from("operator_transport_types").select("journey_type_id").eq("operator_id", params.id),
        ]);
        if (error || !data) {
          setMsg(error?.message ?? "Could not load operator.");
        } else {
          setEditingId(data.id);
          setCountryId(data.country_id ?? "");
          setName(data.name ?? "");
          setAdminEmail(data.admin_email ?? "");
          setPhone(data.phone ?? "");
          setAddress1(data.address1 ?? "");
          setAddress2(data.address2 ?? "");
          setTown(data.town ?? "");
          setRegion(data.region ?? "");
          setPostalCode(data.postal_code ?? "");
          setExistingLogoPath(data.logo_url ?? null);
          setJourneyTypeIds((relData as OperatorTypeRel[] | null)?.map((r) => r.journey_type_id) ?? []);

          // preview existing logo
          if (data.logo_url) {
            const url = await resolveLogoUrl(data.logo_url);
            setLogoPreviewUrl(url);
          }
        }
      }
      setLoading(false);
    })();
    return () => { off = true; };
  }, [isNew, params?.id]);

  function toggleJourneyType(id: string) {
    setJourneyTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** Upload logo and return STORAGE PATH (not URL). */
  async function uploadLogoIfAny(operatorId: string): Promise<string | null> {
    if (!logoFile) return null;
    const safeName = logoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `${STORAGE_PREFIX}/${operatorId}/${Date.now()}-${safeName}`;
    const { error } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(path, logoFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: logoFile.type || "image/*",
      });
    if (error) {
      setMsg(`Logo upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

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

        // upload logo and patch
        if (id && logoFile) {
          const path = await uploadLogoIfAny(id);
          if (path) {
            await fetch(`/api/admin/operators/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ logo_url: path }),
            });
          }
        }

        setMsg("Created ✅");
        router.push("/admin/operators");
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
        router.push("/admin/operators");
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (!confirm("Delete operator?")) return;
    const res = await fetch(`/api/admin/operators/${editingId}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body?.error || `Delete failed (${res.status})`);
      return;
    }
    router.push("/admin/operators");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/admin/operators" className="rounded-full px-3 py-1 border text-sm">← Back</Link>
        <h1 className="text-2xl font-semibold">{isNew ? "New Operator" : "Edit Operator"}</h1>
        <div className="ml-auto flex items-center gap-2">
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

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        {loading ? (
          <div>Loading…</div>
        ) : (
          <form onSubmit={onSave} className="space-y-6">
            {/* Country + Name */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Country *</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={countryId}
                  onChange={(e) => setCountryId(e.target.value)}
                >
                  <option value="">— Select —</option>
                  {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Operator Name *</label>
                <input
                  className="w-full border rounded-lg px-3 py-2"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g., Island Fast Boats"
                />
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
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    setLogoFile(f);
                    if (f) {
                      setLogoPreviewUrl(URL.createObjectURL(f));
                    } else if (existingLogoPath) {
                      setLogoPreviewUrl(await resolveLogoUrl(existingLogoPath));
                    } else {
                      setLogoPreviewUrl(null);
                    }
                  }}
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Stored in bucket <code>{STORAGE_BUCKET}</code> at <code>{STORAGE_PREFIX}/&lt;operatorId&gt;/</code>
                </p>
                {logoPreviewUrl && (
                  <div className="mt-2 h-32 w-full rounded overflow-hidden border">
                    <img src={logoPreviewUrl} alt="Logo preview" className="h-full w-full object-cover" />
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm text-neutral-600 mb-1">
                  Services (Transport Types){editingId ? "" : " *"}
                </label>
                <div className="flex flex-wrap gap-2">
                  {journeyTypes.map((jt) => (
                    <label
                      key={jt.id}
                      className={cls(
                        "inline-flex items-center gap-2 border rounded-full px-3 py-1 cursor-pointer",
                        journeyTypeIds.includes(jt.id) && "bg-black text-white border-black"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={journeyTypeIds.includes(jt.id)}
                        onChange={() => toggleJourneyType(jt.id)}
                      />
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
              <Link href="/admin/operators" className="inline-flex rounded-full px-4 py-2 border text-sm">Cancel</Link>
              {msg && <span className="text-sm text-neutral-600">{msg}</span>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
