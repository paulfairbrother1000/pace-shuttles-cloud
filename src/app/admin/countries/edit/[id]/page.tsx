"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

type UUID = string;

type WorldCountry = { code: string; name: string };
type Country = {
  id: UUID;
  name: string;
  code: string | null;
  description: string | null;
  picture_url: string | null;
  created_at: string | null;
};

const IMAGE_BUCKET = "images";

const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

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

export default function EditCountryPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const isCreate = params.id === "new";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [world, setWorld] = useState<WorldCountry[]>([]);
  const [row, setRow] = useState<Country>({
    id: "" as UUID,
    name: "",
    code: "",
    description: "",
    picture_url: null,
    created_at: null,
  });

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let off = false;
    (async () => {
      if (!sb) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr(null);
      try {
        const { data: un, error: unErr } = await sb
          .from("un_countries")
          .select("code,name")
          .order("name");
        if (unErr) throw unErr;
        if (!off) setWorld((un || []) as WorldCountry[]);

        if (!isCreate) {
          const { data, error } = await sb
            .from("countries")
            .select("id,name,code,description,picture_url,created_at")
            .eq("id", params.id)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("Country not found.");
          const r = data as Country;
          if (!off) {
            setRow(r);
            setPreview(publicImage(r.picture_url) || null);
          }
        } else {
          setRow({
            id: "" as UUID,
            name: "",
            code: "",
            description: "",
            picture_url: null,
            created_at: null,
          });
          setPreview(null);
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [isCreate, params.id]);

  const canSave = useMemo(
    () => !!(row.name || "").trim() && !!(row.code || "").trim(),
    [row.name, row.code]
  );

  function update<K extends keyof Country>(k: K, v: Country[K]) {
    setRow((r) => ({ ...r, [k]: v }));
  }

  async function onSave() {
    if (!sb || !canSave) return;
    setErr(null);
    setSaving(true);
    try {
      let picture_url: string | null = row.picture_url ?? null;

      if (file) {
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
        const safeCode = (row.code || "xx").toLowerCase();
        const path = `countries/${safeCode}-${slugify(row.name || "country")}.${ext}`;
        const { error: upErr } = await sb.storage
          .from(IMAGE_BUCKET)
          .upload(path, file, {
            upsert: true,
            cacheControl: "3600",
            contentType: file.type || (ext === "png" ? "image/png" : "image/jpeg"),
          });
        if (upErr) throw upErr;
        const { data: pub } = sb.storage.from(IMAGE_BUCKET).getPublicUrl(path);
        picture_url = pub?.publicUrl || null;
      }

      const payload = {
        name: (row.name || "").trim(),
        code: (row.code || "").trim(),
        description: (row.description || "") || null,
        picture_url,
      };

      if (isCreate) {
        const { error } = await sb.from("countries").insert([payload as any]);
        if (error) throw error;
      } else {
        const { error } = await sb.from("countries").update(payload as any).eq("id", params.id);
        if (error) throw error;
      }

      router.push("/admin/countries");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!sb || isCreate) return;
    if (!confirm("Delete this country? This cannot be undone.")) return;

    setErr(null);
    setDeleting(true);
    try {
      // prevent deleting if referenced anywhere
      const [dest, pu, ops, rts] = await Promise.all([
        sb.from("destinations").select("id", { count: "exact", head: true }).eq("country_id", params.id),
        sb.from("pickup_points").select("id", { count: "exact", head: true }).eq("country_id", params.id),
        sb.from("operators").select("id", { count: "exact", head: true }).eq("country_id", params.id),
        sb.from("routes").select("id", { count: "exact", head: true }).eq("country_id", params.id),
      ]);
      const refs =
        (dest.count ?? 0) + (pu.count ?? 0) + (ops.count ?? 0) + (rts.count ?? 0);
      if (refs > 0) throw new Error(`Cannot delete — referenced by ${refs} record(s).`);

      // best-effort image cleanup
      if (row.picture_url) {
        const info = parsePublicUrl(row.picture_url);
        if (info) await sb.storage.from(info.bucket).remove([info.path]);
      }

      const { error } = await sb.from("countries").delete().eq("id", params.id);
      if (error) throw error;

      router.push("/admin/countries");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
      setDeleting(false);
    }
  }

  return (
    <div className="px-4 py-6 mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-3">
        <button className="px-3 py-1 rounded-lg border hover:bg-neutral-50" onClick={() => router.back()}>
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">
          {isCreate ? "New Country" : "Edit Country"}
        </h1>
      </header>

      {err && <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">{err}</div>}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-neutral-700">UN Country *</span>
                  <select
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.code || ""}
                    onChange={(e) => update("code", e.target.value || "")}
                  >
                    <option value="">— Choose a country —</option>
                    {world.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700">Display name *</span>
                  <input
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                    value={row.name || ""}
                    onChange={(e) => update("name", e.target.value)}
                    placeholder="Country name"
                  />
                </label>

                <label className="block text-sm">
                  <span className="text-neutral-700">Description</span>
                  <textarea
                    className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[100px]"
                    value={row.description || ""}
                    onChange={(e) => update("description", e.target.value || "")}
                    placeholder="Optional description"
                  />
                </label>
              </div>

              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-neutral-700">Photo</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      setPreview(
                        f ? URL.createObjectURL(f) : (publicImage(row.picture_url) || null)
                      );
                    }}
                  />
                </label>

                <div className="relative w-full overflow-hidden rounded-lg border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview || publicImage(row.picture_url) || "/placeholder.png"}
                    alt={row.name || "preview"}
                    className="w-full h-48 object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).src = "/placeholder.png";
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t flex items-center gap-2 justify-end">
              {!isCreate && (
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border text-rose-700 border-rose-300 hover:bg-rose-50"
                  onClick={onDelete}
                  disabled={deleting}
                  title={deleting ? "Deleting…" : "Delete"}
                >
                  {deleting ? "Deleting…" : "Delete"}
                </button>
              )}
              <button
                type="button"
                className="px-4 py-2 rounded-lg border hover:bg-neutral-50"
                onClick={() => router.back()}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg text-white disabled:opacity-60"
                style={{ backgroundColor: "#2563eb" }}
                disabled={!canSave || saving}
              >
                {saving ? "Saving…" : isCreate ? "Create Country" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
