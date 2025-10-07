"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type Destination = {
  id: UUID;
  name: string;
  description: string | null;
  picture_url: string | null;
  url: string | null;
  country_id: UUID | null;
};

type Country = { id: UUID; name: string };

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

export default function DestinationEditPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const isCreate = params.id === "new";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [countries, setCountries] = useState<Country[]>([]);

  const [form, setForm] = useState<Destination>({
    id: "" as UUID,
    name: "",
    description: "",
    picture_url: "",
    url: "",
    country_id: null,
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

      try {
        // Load countries (for dropdown)
        const { data: cData, error: cErr } = await supabase
          .from("countries")
          .select("id,name")
          .order("name", { ascending: true });
        if (cErr) throw cErr;
        if (!off) setCountries((cData || []) as Country[]);

        if (!isCreate) {
          const { data, error } = await supabase
            .from("destinations")
            .select("id,name,description,picture_url,url,country_id")
            .eq("id", params.id)
            .maybeSingle();

          if (error) throw error;
          if (!data) throw new Error("Destination not found");

          if (!off)
            setForm({
              id: data.id,
              name: data.name ?? "",
              description: data.description ?? "",
              picture_url: data.picture_url ?? "",
              url: data.url ?? "",
              country_id: data.country_id ?? null,
            });
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

  async function handleSave() {
    if (!supabase) return;
    setSaving(true);
    setErr(null);
    try {
      if (isCreate) {
        const ins = await supabase
          .from("destinations")
          .insert({
            name: form.name || null,
            description: form.description || null,
            picture_url: form.picture_url || null,
            url: form.url || null,
            country_id: form.country_id || null,
          })
          .select("id")
          .single();
        if (ins.error) throw ins.error;
        // Go back to list
        router.push("/admin/destinations");
      } else {
        const upd = await supabase
          .from("destinations")
          .update({
            name: form.name || null,
            description: form.description || null,
            picture_url: form.picture_url || null,
            url: form.url || null,
            country_id: form.country_id || null,
          })
          .eq("id", params.id);
        if (upd.error) throw upd.error;
        router.push("/admin/destinations");
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const title = isCreate ? "New Destination" : "Edit Destination";

  return (
    <div className="px-6 py-6 mx-auto max-w-[800px] space-y-4">
      <header className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/admin/destinations"
            className="px-3 py-1.5 rounded-lg border"
          >
            Back
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 rounded-lg text-white"
            style={{ backgroundColor: saving ? "#9ca3af" : "#2563eb" }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSave();
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <textarea
              className="w-full border rounded-lg px-3 py-2 min-h-[120px]"
              value={form.description || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Image URL</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.picture_url || ""}
              onChange={(e) =>
                setForm((f) => ({ ...f, picture_url: e.target.value }))
              }
              placeholder="/images/destinations/xx.jpg or full URL"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">External URL</label>
            <input
              className="w-full border rounded-lg px-3 py-2"
              value={form.url || ""}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://…"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Country</label>
            <select
              className="w-full border rounded-lg px-3 py-2"
              value={form.country_id || ""}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  country_id: e.target.value ? (e.target.value as UUID) : null,
                }))
              }
            >
              <option value="">— none —</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </form>
      )}
    </div>
  );
}
