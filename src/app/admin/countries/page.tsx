"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";
// ...



/* ---------- Supabase client (inline) ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Config & helpers ---------- */
const IMAGE_BUCKET = "images";

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

/* ---------- Types ---------- */
type WorldCountry = { code: string; name: string };
type Country = {
  id: string;
  name: string;
  code: string | null;            // stored silently
  description: string | null;
  picture_url: string | null;
  created_at: string | null;
};

export default function ParticipatingCountriesPage() {
  const [world, setWorld] = useState<WorldCountry[]>([]);
  const [rows, setRows] = useState<Country[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // form
  const [selectedCode, setSelectedCode] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const canSave = useMemo(() => !!selectedCode && !!name.trim(), [selectedCode, name]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: un, error: unErr }, { data: cs, error: cErr }] = await Promise.all([
        sb.from("un_countries").select("code,name").order("name"),
        sb.from("countries").select("id,name,code,description,picture_url,created_at").order("name"),
      ]);
      if (unErr) setMsg(unErr.message);
      if (cErr) setMsg(cErr.message);
      setWorld((un as WorldCountry[]) || []);
      setRows((cs as Country[]) || []);
      setLoading(false);
    })();
  }, []);

  function onSelectCountry(code: string) {
    setSelectedCode(code);
    setMsg(null);
    const existing = rows.find((r) => r.code === code);
    const wc = world.find((x) => x.code === code);
    if (existing) {
      setEditingId(existing.id);
      setName(existing.name || wc?.name || "");
      setDescription(existing.description || "");
      setPreview(existing.picture_url || null);
      setFile(null);
      setMsg(`Editing: ${existing.name}`);
    } else {
      setEditingId(null);
      setName(wc?.name || "");
      setDescription("");
      setPreview(null);
      setFile(null);
    }
  }

  async function reloadList() {
    const { data, error } = await sb
      .from("countries")
      .select("id,name,code,description,picture_url,created_at")
      .order("name");
    if (error) setMsg(error.message);
    setRows((data as Country[]) || []);
  }

  function resetForm() {
    setEditingId(null);
    setSelectedCode("");
    setName("");
    setDescription("");
    setPreview(null);
    setFile(null);
    setMsg(null);
  }

  async function onSave() {
    try {
      setMsg(null);
      if (!canSave) return setMsg("Please select a country and enter a name.");

      let picture_url = preview ?? null;
      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const path = `countries/${selectedCode.toLowerCase()}-${slugify(name)}.${ext}`;
        const { error: upErr } = await sb.storage
          .from(IMAGE_BUCKET)
          .upload(path, file, {
            upsert: true,
            cacheControl: "3600",
            contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
          });
        if (upErr) return setMsg(`Upload failed: ${upErr.message}`);
        const { data: pub } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(path);
        picture_url = pub?.publicUrl || null;
      }

      const payload = {
        name: name.trim(),
        code: selectedCode, // stored but not shown
        description: description.trim() || null,
        picture_url,
      };

      const { error } = editingId
        ? await sb.from("countries").update(payload).eq("id", editingId)
        : await sb.from("countries").insert([payload]);

      if (error) return setMsg(error.message);
      await reloadList();
      setMsg(editingId ? "Updated." : "Created.");
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    }
  }

  async function onDelete(row: Country) {
    setMsg(null);
    const [dest, pu, ops, rts] = await Promise.all([
      sb.from("destinations").select("id", { count: "exact", head: true }).eq("country_id", row.id),
      sb.from("pickup_points").select("id", { count: "exact", head: true }).eq("country_id", row.id),
      sb.from("operators").select("id", { count: "exact", head: true }).eq("country_id", row.id),
      sb.from("routes").select("id", { count: "exact", head: true }).eq("country_id", row.id),
    ]);
    const refs = (dest.count ?? 0) + (pu.count ?? 0) + (ops.count ?? 0) + (rts.count ?? 0);
    if (refs > 0) {
      return setMsg(`Cannot delete "${row.name}" — referenced by ${refs} related record(s).`);
    }

    if (row.picture_url) {
      const info = parsePublicUrl(row.picture_url);
      if (info) await sb.storage.from(info.bucket).remove([info.path]);
    }
    const { error } = await sb.from("countries").delete().eq("id", row.id);
    if (error) return setMsg(error.message);
    await reloadList();
    if (editingId === row.id) resetForm();
    setMsg("Deleted.");
  }

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => r.name?.toLowerCase().includes(s));
  }, [rows, search]);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Participating Countries</h1>
        <p className="text-neutral-600">
          Select a country, add a photo and description. Create, edit, and delete participating countries.
        </p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        <form onSubmit={(e) => { e.preventDefault(); onSave(); }} className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">Select country *</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={selectedCode}
                onChange={(e) => onSelectCountry(e.target.value)}
              >
                <option value="">— Choose a country —</option>
                {world.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Display name *</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Country name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
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
              {preview && <img src={preview} alt="preview" className="mt-2 h-28 w-48 object-cover rounded-lg border" />}
            </div>
          </div>

          <div>
            <label className="block text-sm text-neutral-600 mb-1">Description</label>
            <textarea
              rows={3}
              className="w-full border rounded-lg px-3 py-2"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
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
            placeholder="Search participating countries…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No participating countries yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Country</th>
                  <th className="text-left p-3">Photo</th>
                  <th className="text-left p-3">Description</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3">{r.name}</td>
                    <td className="p-3">
                      {r.picture_url ? (
                        <img src={r.picture_url} alt={r.name} className="h-12 w-20 object-cover rounded border" />
                      ) : "—"}
                    </td>
                    <td className="p-3">
                      <div className="text-sm text-neutral-700 line-clamp-3">{r.description ?? "—"}</div>
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => onSelectCountry(r.code || "")}>
                        Edit
                      </button>
                      <button className="px-3 py-1 rounded-full border" onClick={() => onDelete(r)}>
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
