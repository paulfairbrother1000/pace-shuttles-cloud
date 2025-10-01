"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type PsUser = { id: string; site_admin?: boolean | null };

type TransportType = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  picture_url: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string | null;
};

const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function AdminTransportTypesPage() {
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isSiteAdmin = Boolean(psUser?.site_admin);

  const [rows, setRows] = useState<TransportType[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      const u = raw ? (JSON.parse(raw) as PsUser) : null;
      setPsUser(u);
    } catch {
      setPsUser(null);
    }
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const { data, error } = await sb
        .from("transport_types")
        .select("id,name,slug,description,picture_url,is_active,sort_order,created_at")
        .order("sort_order", { ascending: false })
        .order("name");
      if (off) return;
      if (error) setMsg(error.message);
      setRows((data as TransportType[]) || []);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  useEffect(() => {
    let off = false;
    (async () => {
      const entries = await Promise.all(
        rows.map(async (r) => [r.id, await resolveStorageUrl(r.picture_url)] as const)
      );
      if (!off) setThumbs(Object.fromEntries(entries));
    })();
    return () => {
      off = true;
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(s) ||
        (r.slug ?? "").toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s)
    );
  }, [rows, q]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setSlug("");
    setDescription("");
    setIsActive(true);
    setSortOrder(0);
    setPhotoFile(null);
    setMsg(null);
  }

  async function reloadRows() {
    const { data, error } = await sb
      .from("transport_types")
      .select("id,name,slug,description,picture_url,is_active,sort_order,created_at")
      .order("sort_order", { ascending: false })
      .order("name");
    if (error) setMsg(error.message);
    setRows((data as TransportType[]) || []);
  }

  async function uploadPhotoIfAny(typeId: string) {
    if (!photoFile) return null;
    const safe = photoFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `transport-types/${typeId}/${Date.now()}-${safe}`;
    const { error } = await sb.storage
      .from("images")
      .upload(path, photoFile, {
        cacheControl: "3600",
        upsert: true,
        contentType: photoFile.type || "image/*",
      });
    if (error) {
      setMsg(`Image upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isSiteAdmin) return setMsg("Only site admins can make changes.");
    if (!name.trim()) return setMsg("Please enter a name.");

    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim() ? slugify(slug) : slugify(name),
        description: description.trim() || null,
        is_active: isActive,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      };

      if (!editingId) {
        // CREATE via API
        const res = await fetch("/api/admin/transport-types", {
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
            const patch = await fetch(`/api/admin/transport-types/${id}`, {
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

        await reloadRows();
        resetForm();
        setMsg("Created ✅");
      } else {
        // UPDATE via API
        const id = editingId;
        const toUpdate = { ...payload } as any;

        if (photoFile) {
          const path = await uploadPhotoIfAny(id);
          if (path) toUpdate.picture_url = path;
        }

        const res = await fetch(`/api/admin/transport-types/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(toUpdate),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Update failed (${res.status})`);
        }

        await reloadRows();
        resetForm();
        setMsg("Updated ✅");
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onEdit(id: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setEditingId(id);
    setName(row.name);
    setSlug(row.slug ?? "");
    setDescription(row.description ?? "");
    setIsActive(row.is_active);
    setSortOrder(row.sort_order ?? 0);
    setPhotoFile(null);
    setMsg(`Editing: ${row.name}`);
  }

  async function onDelete(id: string) {
    if (!isSiteAdmin) return setMsg("Only site admins can make changes.");
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    if (!confirm(`Delete transport type "${row.name}"?`)) return;

    setDeletingId(id);
    const res = await fetch(`/api/admin/transport-types/${id}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeletingId(null);
      return setMsg(body?.error || `Delete failed (${res.status})`);
    }
    await reloadRows();
    setDeletingId(null);
    setMsg("Deleted.");
  }

  if (!isSiteAdmin) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-semibold">Transport Types</h1>
        <p className="mt-2 text-neutral-600">This account is not a site admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Transport Types</h1>
        <p className="text-neutral-600">Create, edit, and delete transport types. Images power the homepage filter.</p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border bg-white p-5 shadow space-y-5">
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Name *</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!editingId) setSlug(slugify(e.target.value));
                }}
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Slug</label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="auto-generated from name"
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Sort Order</label>
              <input
                type="number"
                className="w-full border rounded-lg px-3 py-2"
                value={sortOrder}
                onChange={(e) => setSortOrder(parseInt(e.target.value || "0", 10))}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">Description</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Active</label>
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Show on homepage when in use</span>
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Image</label>
              <input type="file" accept="image/*" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in <code>images/transport-types/&lt;typeId&gt;/</code>. Aim for a square image.
              </p>
            </div>
            {photoFile && (
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Preview</label>
                <div className="h-24 w-24 border rounded overflow-hidden">
                  <img src={URL.createObjectURL(photoFile)} alt="preview" className="h-full w-full object-cover" />
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update Type" : "Create Type"}
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

      {/* List */}
      <section className="space-y-3">
        <div className="flex gap-2 items-center">
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Search types…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No transport types.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Image</th>
                  <th className="text-left p-3">Name</th>
                  <th className="text-left p-3">Slug</th>
                  <th className="text-left p-3">Active</th>
                  <th className="text-left p-3">Sort</th>
                  <th className="text-left p-3">Description</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3 w-[80px]">
                      {thumbs[r.id] ? (
                        <img
                          src={thumbs[r.id]!}
                          alt={r.name}
                          className="h-10 w-10 rounded object-cover border"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                          }}
                        />
                      ) : (
                        <div className="h-10 w-10 rounded border bg-neutral-100" />
                      )}
                    </td>
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3">{r.slug ?? "—"}</td>
                    <td className="p-3">{r.is_active ? "Yes" : "No"}</td>
                    <td className="p-3">{r.sort_order}</td>
                    <td className="p-3">{r.description ?? "—"}</td>
                    <td className="p-3 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => onEdit(r.id)}>
                        Edit
                      </button>
                      <button
                        className="px-3 py-1 rounded-full border"
                        onClick={() => onDelete(r.id)}
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
