// src/app/admin/transport-types/edit/[id]/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type PsUser = { id: string; site_admin?: boolean | null };
type TransportType = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  picture_url: string | null; // STORAGE PATH or full URL
  is_active: boolean;
  sort_order: number;
};

/* ---------- Helpers ---------- */
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
    .toLowerCase().trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function TransportTypeEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = !params?.id || params.id === "new";

  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const isSiteAdmin = Boolean(psUser?.site_admin);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(isNew ? null : params.id);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [sortOrder, setSortOrder] = useState<number>(0);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [existingPath, setExistingPath] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* Who am I */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);

  /* Load record (when editing) */
  useEffect(() => {
    let off = false;
    (async () => {
      if (isNew) { setLoading(false); return; }
      const { data, error } = await sb
        .from("transport_types")
        .select("id,name,slug,description,picture_url,is_active,sort_order")
        .eq("id", params.id)
        .single();
      if (off) return;
      if (error || !data) {
        setMsg(error?.message || "Load failed");
        setLoading(false);
        return;
      }
      setEditingId(data.id);
      setName(data.name);
      setSlug(data.slug ?? "");
      setDescription(data.description ?? "");
      setIsActive(data.is_active);
      setSortOrder(data.sort_order ?? 0);
      setExistingPath(data.picture_url ?? null);
      setPreviewUrl(await resolveStorageUrl(data.picture_url ?? null));
      setLoading(false);
    })();
    return () => { off = true; };
  }, [isNew, params?.id]);

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
        // CREATE
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
            await fetch(`/api/admin/transport-types/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ picture_url: path }),
            });
          }
        }

        router.push("/admin/transport-types");
      } else {
        // UPDATE
        const id = editingId;
        const toUpdate: any = { ...payload };
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
        router.push("/admin/transport-types");
      }
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (!confirm("Delete this transport type?")) return;
    const res = await fetch(`/api/admin/transport-types/${editingId}`, {
      method: "DELETE",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return setMsg(body?.error || `Delete failed (${res.status})`);
    }
    router.push("/admin/transport-types");
  }

  if (!isSiteAdmin) {
    return (
      <div className="p-4">
        <h1 className="text-2xl font-semibold">Admin • Transport Types</h1>
        <p className="mt-2 text-neutral-600">This account is not a site admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/admin/transport-types" className="rounded-full px-3 py-1 border text-sm">← Back</Link>
        <h1 className="text-2xl font-semibold">{isNew ? "New Transport Type" : "Edit Transport Type"}</h1>
        <div className="ml-auto">
          {!isNew && (
            <button onClick={onDelete} className="rounded-full px-4 py-2 border text-sm">Delete</button>
          )}
        </div>
      </div>

      {/* ---- New quick menu (additive) ---- */}
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/transport-types" className="rounded-full border px-3 py-1 hover:bg-neutral-50">
          All types
        </Link>
        <Link href="/admin/transport-types/edit/new" className="rounded-full border px-3 py-1 hover:bg-neutral-50">
          Create new
        </Link>
        {!isNew && (
          <span className="rounded-full border px-3 py-1 bg-neutral-100">Editing: {editingId}</span>
        )}
      </nav>
      {/* ---- end new menu ---- */}

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
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.target.files?.[0] || null;
                    setPhotoFile(f);
                    setPreviewUrl(f ? URL.createObjectURL(f) : await resolveStorageUrl(existingPath));
                  }}
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Stored in <code>images/transport-types/&lt;typeId&gt;/</code>. Aim for a square image.
                </p>
              </div>
              {previewUrl && (
                <div>
                  <label className="block text-sm text-neutral-600 mb-1">Preview</label>
                  <div className="h-32 w-32 border rounded overflow-hidden">
                    <img src={previewUrl} alt="preview" className="h-full w-full object-cover" />
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
              <Link href="/admin/transport-types" className="inline-flex rounded-full px-4 py-2 border text-sm">
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
