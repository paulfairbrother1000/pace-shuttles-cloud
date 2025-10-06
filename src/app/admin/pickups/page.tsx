"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import Image from "next/image";
import { publicImage } from "@/lib/publicImage";

/* -------- Supabase (client-side) -------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* -------- Config -------- */
const BUCKET = "images";
const FOLDER = "pickup-points";

/* -------- Helpers -------- */
function slugify(s: string) {
  return s.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function parsePublicUrl(publicUrl: string): { bucket: string; path: string } | null {
  try {
    const u = new URL(publicUrl);
    const marker = "/storage/v1/object/public/";
    const i = u.pathname.indexOf(marker);
    if (i === -1) return null;
    const after = u.pathname.slice(i + marker.length);
    const slash = after.indexOf("/");
    if (slash === -1) return null;
    return { bucket: after.slice(0, slash), path: after.slice(slash + 1) };
  } catch {
    return null;
  }
}

/* -------- Types -------- */
type Country = { id: string; name: string };
type TransportType = { id: string; name: string };
type TransportPlace = { id: string; transport_type_id: string; name: string };

type Row = {
  id: string;
  name: string;
  country_id: string;
  picture_url: string | null;
  description: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  transport_type_id: string | null;
  transport_type_place_id: string | null;
};

export default function AdminPickupPointsPage() {
  /* Lookups */
  const [countries, setCountries] = useState<Country[]>([]);
  const [types, setTypes] = useState<TransportType[]>([]);
  const [places, setPlaces] = useState<TransportPlace[]>([]);

  /* Rows */
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  /* Form */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [countryId, setCountryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [placeId, setPlaceId] = useState<string>("");
  const [description, setDescription] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [town, setTown] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  /* UI */
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canSave = useMemo(
    () => !!name.trim() && !!countryId && !!typeId,
    [name, countryId, typeId]
  );

  const countryName = (id: string | null) =>
    countries.find((c) => c.id === id)?.name ?? (id ?? "");
  const typeName = (id: string | null) =>
    types.find((t) => t.id === id)?.name ?? (id ?? "");
  const placeName = (id: string | null) =>
    places.find((p) => p.id === id)?.name ?? (id ?? "");

  const placesForType = useMemo(
    () => places.filter((p) => p.transport_type_id === typeId),
    [places, typeId]
  );

  /* -------- Initial load -------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);

      const countriesQ = sb.from("countries").select("id,name").order("name");
      const typesQ = sb.from("transport_types").select("id,name").order("name");
      const placesQ = sb
        .from("transport_type_places")
        .select("id,transport_type_id,name")
        .order("name");
      const pickupsQ = sb.from("pickup_points").select("*").order("name");

      const [
        { data: cs, error: cErr },
        { data: ts, error: tErr },
        { data: ps, error: pErr },
        { data: ds, error: dErr },
      ] = await Promise.all([countriesQ, typesQ, placesQ, pickupsQ]);

      if (cancelled) return;

      if (cErr || tErr || pErr || dErr) {
        console.error("Load errors:", { cErr, tErr, pErr, dErr });
        setMsg(dErr?.message || cErr?.message || tErr?.message || pErr?.message || "Load failed");
      }

      setCountries((cs as Country[]) || []);
      setTypes((ts as TransportType[]) || []);
      setPlaces((ps as TransportPlace[]) || []);
      setRows((ds as Row[]) || []);
      setLoading(false);

      console.log("pickup_points rows:", ds);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadRows() {
    const { data, error } = await sb.from("pickup_points").select("*").order("name");
    if (error) {
      console.error(error);
      setMsg(error.message);
    }
    setRows((data as Row[]) || []);
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setCountryId("");
    setTypeId("");
    setPlaceId("");
    setDescription("");
    setAddress1("");
    setAddress2("");
    setTown("");
    setRegion("");
    setPostal("");
    setFile(null);
    setPreview(null);
    setMsg(null);
  }

  async function loadOne(id: string) {
    const { data, error } = await sb.from("pickup_points").select("*").eq("id", id).single();
    if (error || !data) {
      setMsg(error?.message ?? "Could not load pick-up point.");
      return;
    }
    setEditingId(id);
    setName(data.name ?? "");
    setCountryId(data.country_id ?? "");
    setTypeId(data.transport_type_id ?? "");
    setPlaceId(data.transport_type_place_id ?? "");
    setDescription(data.description ?? "");
    setAddress1(data.address1 ?? "");
    setAddress2(data.address2 ?? "");
    setTown(data.town ?? "");
    setRegion(data.region ?? "");
    setPostal(data.postal_code ?? "");
    setFile(null);
    setPreview(data.picture_url || null);
    setMsg(`Editing: ${data.name}`);
  }

  async function onSave() {
    try {
      setMsg(null);
      if (!canSave) return setMsg("Enter name, country, and transport type.");
      setSaving(true);

      // Optional upload
      let picture_url: string | null = preview ?? null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `${FOLDER}/${slugify(name)}.${ext}`;
        const { error: upErr } = await sb.storage
          .from(BUCKET)
          .upload(path, file, {
            upsert: true,
            cacheControl: "3600",
            contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
          });
        if (upErr) {
          setSaving(false);
          return setMsg(`Upload failed: ${upErr.message}`);
        }
        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        picture_url = pub?.publicUrl || null;
      }

      const payload = {
        name: name.trim(),
        country_id: countryId,
        transport_type_id: typeId,
        transport_type_place_id: placeId || null,
        description: description.trim() || null,
        address1: address1.trim() || null,
        address2: address2.trim() || null,
        town: town.trim() || null,
        region: region.trim() || null,
        postal_code: postal.trim() || null,
        picture_url,
      };

      let res: Response;
      if (editingId) {
        res = await fetch(`/api/admin/pickups/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(`/api/admin/pickups`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaving(false);
        return setMsg(body?.error || `Save failed (${res.status})`);
      }

      setMsg(editingId ? "Updated." : "Created.");
      await reloadRows();
      if (!editingId) resetForm();
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(row: Row) {
    if (!confirm(`Delete "${row.name}"? This cannot be undone.`)) return;

    setMsg(null);
    setDeletingId(row.id);

    // Guard: referenced by routes?
    const { count, error: refErr } = await sb
      .from("routes")
      .select("id", { count: "exact", head: true })
      .eq("pickup_id", row.id);
    if (refErr) {
      setDeletingId(null);
      setMsg(refErr.message);
      return;
    }
    if ((count ?? 0) > 0) {
      setDeletingId(null);
      setMsg(`Cannot delete "${row.name}" — used by ${count} route(s).`);
      return;
    }

    const res = await fetch(`/api/admin/pickups/${row.id}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeletingId(null);
      setMsg(body?.error || `Delete failed (${res.status})`);
      return;
    }

    if (editingId === row.id) resetForm();
    await reloadRows();
    setDeletingId(null);
    setMsg("Deleted.");
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name?.toLowerCase().includes(s) ||
        countryName(r.country_id).toLowerCase().includes(s) ||
        typeName(r.transport_type_id).toLowerCase().includes(s) ||
        placeName(r.transport_type_place_id).toLowerCase().includes(s)
    );
  }, [rows, q, countries, types, places]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Pick-up Points</h1>
        <p className="text-neutral-600">
          Create, edit and delete pick-up points. Photos are stored under{" "}
          <code>{BUCKET}/{FOLDER}</code>.
        </p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Name *</label>
              <input className="w-full border rounded-lg px-3 py-2" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Country *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={countryId} onChange={(e) => setCountryId(e.target.value)}>
                <option value="">— Select —</option>
                {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Photo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setFile(f);
                  setPreview(f ? URL.createObjectURL(f) : preview);
                }}
              />
              {preview && <img src={preview} alt="preview" className="mt-2 h-24 w-40 object-cover rounded border" />}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Transport type *</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setPlaceId("");
                }}
              >
                <option value="">— Select —</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Place (optional)</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={placeId}
                onChange={(e) => setPlaceId(e.target.value)}
                disabled={!typeId}
              >
                <option value="">— None —</option>
                {placesForType.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div />
          </div>

          {/* Address */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Address 1</label>
              <input className="w-full border rounded-lg px-3 py-2" value={address1} onChange={(e) => setAddress1(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Address 2</label>
              <input className="w-full border rounded-lg px-3 py-2" value={address2} onChange={(e) => setAddress2(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Town / City</label>
              <input className="w-full border rounded-lg px-3 py-2" value={town} onChange={(e) => setTown(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Region / State</label>
              <input className="w-full border rounded-lg px-3 py-2" value={region} onChange={(e) => setRegion(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Postal code</label>
              <input className="w-full border rounded-lg px-3 py-2" value={postal} onChange={(e) => setPostal(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 mb-1">Description</label>
            <textarea rows={3} className="w-full border rounded-lg px-3 py-2" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="flex items-center gap-2">
            <button className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50" disabled={!canSave || saving}>
              {saving ? "Saving…" : editingId ? "Update" : "Create"}
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
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Search pick-up points…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No pick-up points yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Country</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-left p-3">Place</th>
                  <th className="text-left p-3">Photo</th>
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
                    <td className="p-3">{countryName(r.country_id)}</td>
                    <td className="p-3">{typeName(r.transport_type_id)}</td>
                    <td className="p-3">{placeName(r.transport_type_place_id)}</td>
                    <td className="p-3">
                      <div className="relative h-12 w-20 overflow-hidden rounded border">
                        <Image
                          src={publicImage(r.picture_url) || "/placeholder.png"}
                          alt={r.name || "Pick-up point"}
                          fill
                          className="object-cover"
                          sizes="80px"
                        />
                      </div>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => loadOne(r.id)}>
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 rounded-full border"
                        onClick={() => onRemove(r)}
                        disabled={deletingId === r.id}
                        title={deletingId === r.id ? "Deleting…" : "Delete"}
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
