"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* -------- Supabase client (inline to avoid module issues) -------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* -------- Config -------- */
const BUCKET = "images";          // <- change if your bucket is named differently
const FOLDER = "destinations";    // files saved under `${FOLDER}/slug.ext`

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

/* -------- Types & constants -------- */
type Country = { id: string; name: string };
type Row = {
  id: string;
  name: string;
  country_id: string | null;
  destination_type: "Restaurant" | "Bar" | "Beach Club" | "Restaurant & Bar";
  wet_or_dry: "wet" | "dry";
  picture_url: string | null;
  description: string | null;
  season_from: string | null;
  season_to: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  url: string | null;   // NEW
  gift: string | null;  // NEW
};

const DEST_TYPES = ["Restaurant", "Bar", "Beach Club", "Restaurant & Bar"] as const;
const ARRIVAL_TYPES = ["wet", "dry"] as const;

/* -------- Component -------- */
export default function AdminDestinationsPage() {
  // lists
  const [countries, setCountries] = useState<Country[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  // form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [countryId, setCountryId] = useState<string>("");
  const [destType, setDestType] = useState<typeof DEST_TYPES[number]>("Restaurant");
  const [arrival, setArrival] = useState<typeof ARRIVAL_TYPES[number]>("dry");
  const [description, setDescription] = useState("");
  const [seasonFrom, setSeasonFrom] = useState("");
  const [seasonTo, setSeasonTo] = useState("");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [town, setTown] = useState("");
  const [region, setRegion] = useState("");
  const [postal, setPostal] = useState("");
  const [url, setUrl] = useState("");     // NEW
  const [gift, setGift] = useState("");   // NEW
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // ui
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const canSave = useMemo(() => !!name.trim() && !!countryId, [name, countryId]);
  const countryName = (id: string | null) =>
    countries.find((c) => c.id === id)?.name ?? (id ?? "");

  /* initial load */
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: cs }, { data: ds }] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb
          .from("destinations")
          .select(
            "id,name,country_id,destination_type,wet_or_dry,picture_url,description,season_from,season_to,address1,address2,town,region,postal_code,url,gift"
          )
          .order("created_at", { ascending: false }),
      ]);
      setCountries((cs as Country[]) || []);
      setRows((ds as Row[]) || []);
      setLoading(false);
    })();
  }, []);

  async function reloadRows() {
    const { data } = await sb
      .from("destinations")
      .select(
        "id,name,country_id,destination_type,wet_or_dry,picture_url,description,season_from,season_to,address1,address2,town,region,postal_code,url,gift"
      )
      .order("created_at", { ascending: false });
    setRows((data as Row[]) || []);
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setCountryId("");
    setDestType("Restaurant");
    setArrival("dry");
    setDescription("");
    setSeasonFrom("");
    setSeasonTo("");
    setAddress1("");
    setAddress2("");
    setTown("");
    setRegion("");
    setPostal("");
    setUrl("");   // NEW
    setGift("");  // NEW
    setFile(null);
    setPreview(null);
    setMsg(null);
  }

  async function loadOne(id: string) {
    const { data, error } = await sb.from("destinations").select("*").eq("id", id).single();
    if (error || !data) {
      setMsg(error?.message ?? "Could not load destination.");
      return;
    }
    setEditingId(id);
    setName(data.name ?? "");
    setCountryId(data.country_id ?? "");
    setDestType(data.destination_type ?? "Restaurant");
    setArrival(data.wet_or_dry ?? "dry");
    setDescription(data.description ?? "");
    setSeasonFrom((data.season_from ?? "")?.slice(0, 10));
    setSeasonTo((data.season_to ?? "")?.slice(0, 10));
    setAddress1(data.address1 ?? "");
    setAddress2(data.address2 ?? "");
    setTown(data.town ?? "");
    setRegion(data.region ?? "");
    setPostal(data.postal_code ?? "");
    setUrl(data.url ?? "");     // NEW
    setGift(data.gift ?? "");   // NEW
    setFile(null);
    setPreview(data.picture_url || null);
    setMsg(`Editing: ${data.name}`);
  }

  async function onSave() {
    try {
      setMsg(null);
      if (!canSave) return setMsg("Enter a name and choose a country.");

      // optional upload
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
        if (upErr) return setMsg(`Upload failed: ${upErr.message}`);
        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        picture_url = pub?.publicUrl || null;
      }

      const payload = {
        name: name.trim(),
        country_id: countryId,
        destination_type: destType,
        wet_or_dry: arrival,
        description: description.trim() || null,
        season_from: seasonFrom || null,
        season_to: seasonTo || null,
        address1: address1.trim() || null,
        address2: address2.trim() || null,
        town: town.trim() || null,
        region: region.trim() || null,
        postal_code: postal.trim() || null,
        picture_url,
        url: url.trim() || null,     // NEW
        gift: gift.trim() || null,   // NEW
      };

      const { error } = editingId
        ? await sb.from("destinations").update(payload).eq("id", editingId)
        : await sb.from("destinations").insert([payload]);

      if (error) return setMsg(error.message);
      setMsg(editingId ? "Updated." : "Created.");
      await reloadRows();
      if (!editingId) resetForm();
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    }
  }

  async function onRemove(row: Row) {
    setMsg(null);
    // prevent deletion if referenced by any routes
    const { count } = await sb
      .from("routes")
      .select("id", { count: "exact", head: true })
      .eq("destination_id", row.id);
    if ((count ?? 0) > 0) {
      return setMsg(`Cannot delete "${row.name}" — used by ${count} route(s).`);
    }
    if (row.picture_url) {
      const info = parsePublicUrl(row.picture_url);
      if (info) await sb.storage.from(info.bucket).remove([info.path]);
    }
    const { error } = await sb.from("destinations").delete().eq("id", row.id);
    if (error) return setMsg(error.message);
    if (editingId === row.id) resetForm();
    await reloadRows();
    setMsg("Deleted.");
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name?.toLowerCase().includes(s) ||
        countryName(r.country_id).toLowerCase().includes(s)
    );
  }, [rows, q, countries]);

  /* -------- UI -------- */
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Destinations</h1>
        <p className="text-neutral-600">Create, edit and delete destinations. Photos are stored under <code>{BUCKET}/{FOLDER}</code>.</p>
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
              <input type="file" accept="image/*"
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
              <label className="block text-sm text-neutral-600 mb-1">Type</label>
              <select className="w-full border rounded-lg px-3 py-2" value={destType} onChange={(e) => setDestType(e.target.value as any)}>
                {DEST_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Arrival</label>
              <select className="w-full border rounded-lg px-3 py-2" value={arrival} onChange={(e) => setArrival(e.target.value as any)}>
                {ARRIVAL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div />
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Website</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                placeholder="https://example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">Gift / Benefits</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Free welcome drink for PaceShuttles clients"
                value={gift}
                onChange={(e) => setGift(e.target.value)}
              />
            </div>
          </div>

          {/* Address & Season */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Season from</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2" value={seasonFrom} onChange={(e) => setSeasonFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Season to</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2" value={seasonTo} onChange={(e) => setSeasonTo(e.target.value)} />
            </div>
            <div />
          </div>

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
            <button className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50" disabled={!canSave}>
              {editingId ? "Update" : "Create"}
            </button>
            {editingId && (
              <button type="button" className="inline-flex rounded-full px-4 py-2 border text-sm" onClick={resetForm}>
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
            placeholder="Search destinations…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No destinations yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Country</th>
                  <th className="text-left p-3">Type</th>
                  <th className="text-left p-3">Arrival</th>
                  <th className="text-left p-3">Photo</th>
                  <th className="text-left p-3">Website</th>
                  <th className="text-left p-3">Gift</th>
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
                    <td className="p-3">{r.destination_type}</td>
                    <td className="p-3">{r.wet_or_dry}</td>
                    <td className="p-3">
                      {r.picture_url ? (
                        <img src={r.picture_url} alt={r.name} className="h-12 w-20 object-cover rounded border" />
                      ) : "—"}
                    </td>
                    <td className="p-3">
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">Visit</a>
                      ) : "—"}
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-neutral-700 line-clamp-2">{r.gift ?? "—"}</span>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => loadOne(r.id)}>
                        Edit
                      </button>
                      <button className="px-3 py-1 rounded-full border" onClick={() => onRemove(r)}>
                        Delete
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
