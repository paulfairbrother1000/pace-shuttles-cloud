"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;
type Country = { id: UUID; name: string };
type Destination = {
  id?: UUID;
  name: string;
  description: string | null;
  country_id: UUID | null;
  picture_url: string | null;
  url: string | null;
  is_active: boolean | null;
};

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

export default function EditDestinationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;
  const isNew = !id || id === "new";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [countries, setCountries] = useState<Country[]>([]);

  const [form, setForm] = useState<Destination>({
    name: "",
    description: "",
    country_id: null,
    picture_url: "",
    url: "",
    is_active: true,
  });

  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) {
        setErr("Supabase not configured");
        setLoading(false);
        return;
      }
      setErr(null);
      setLoading(true);

      const [cQ, dQ] = await Promise.all([
        supabase.from("countries").select("id,name").order("name", { ascending: true }),
        isNew
          ? Promise.resolve({ data: null, error: null } as any)
          : supabase
              .from("destinations")
              .select("id,name,description,country_id,picture_url,url,is_active")
              .eq("id", id)
              .single(),
      ]);

      if (off) return;

      if (cQ.error) setErr(cQ.error.message);
      setCountries((cQ.data || []) as Country[]);

      if (!isNew) {
        if (dQ.error) setErr(dQ.error.message);
        if (dQ.data) setForm(dQ.data as Destination);
      }

      setLoading(false);
    })();
    return () => { off = true; };
  }, [id, isNew]);

  async function save() {
    if (!supabase) return;
    setSaving(true);
    setErr(null);
    try {
      if (isNew) {
        const { data, error } = await supabase
          .from("destinations")
          .insert({
            name: form.name.trim(),
            description: form.description || null,
            picture_url: form.picture_url || null,
            country_id: form.country_id || null,
            url: form.url || null,
            is_active: form.is_active ?? true,
          })
          .select("id")
          .single();
        if (error) throw error;
        router.replace(`/admin/destinations/edit/${data.id}`);
      } else {
        const { error } = await supabase
          .from("destinations")
          .update({
            name: form.name.trim(),
            description: form.description || null,
            picture_url: form.picture_url || null,
            country_id: form.country_id || null,
            url: form.url || null,
            is_active: form.is_active ?? true,
          })
          .eq("id", id);
        if (error) throw error;
      }
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!supabase || isNew) return;
    if (!confirm("Delete this destination? This cannot be undone.")) return;
    const { error } = await supabase.from("destinations").delete().eq("id", id);
    if (error) {
      setErr(error.message);
      return;
    }
    router.push("/admin/destinations");
  }

  return (
    <div className="px-6 py-6 mx-auto max-w-[800px] space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          {isNew ? "New Destination" : "Edit Destination"}
        </h1>
        <button
          onClick={() => history.back()}
          className="px-3 py-1.5 rounded-full border"
        >
          ← Back
        </button>
      </div>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <div className="text-sm mb-1">Name</div>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                className="w-full border rounded-lg px-3 py-2"
              />
            </label>

            <label className="block">
              <div className="text-sm mb-1">Country</div>
              <select
                value={form.country_id || ""}
                onChange={(e) =>
                  setForm({ ...form, country_id: e.target.value || null })
                }
                className="w-full border rounded-lg px-3 py-2"
              >
                <option value="">—</option>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <div className="text-sm mb-1">Picture URL</div>
            <input
              value={form.picture_url || ""}
              onChange={(e) =>
                setForm({ ...form, picture_url: e.target.value })
              }
              placeholder="https://… or /storage/v1/object/public/…"
              className="w-full border rounded-lg px-3 py-2"
            />
          </label>

          <label className="block">
            <div className="text-sm mb-1">Website URL</div>
            <input
              value={form.url || ""}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://…"
              className="w-full border rounded-lg px-3 py-2"
            />
          </label>

          <label className="block">
            <div className="text-sm mb-1">Description</div>
            <textarea
              value={form.description || ""}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              rows={5}
              className="w-full border rounded-lg px-3 py-2"
            />
          </label>

          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.is_active}
              onChange={(e) =>
                setForm({ ...form, is_active: e.target.checked })
              }
            />
            <span className="text-sm">Active</span>
          </label>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: "#2563eb", opacity: saving ? 0.7 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>

            {!isNew && (
              <button
                type="button"
                onClick={remove}
                className="px-4 py-2 rounded-lg border border-rose-600 text-rose-700"
              >
                Delete
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
