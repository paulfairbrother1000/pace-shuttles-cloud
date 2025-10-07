"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type CountryRow = {
  id: UUID;
  name: string;
  code: string | null;
  description: string | null;
  picture_url: string | null;
};

/* ---------- Supabase client ---------- */
function supa() {
  if (
    typeof window !== "undefined" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return null;
}

/* ---------- SAME normaliser as the tiles ---------- */
function ensureImageUrl(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw; // already absolute
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return undefined;
  const key = raw.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${key}`;
}

export default function CountryEditPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const client = useMemo(() => supa(), []);
  const isCreate = params.id === "new";

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [row, setRow] = useState<CountryRow>({
    id: "" as UUID,
    name: "",
    code: null,
    description: "",
    picture_url: "",
  });

  // preview uses the SAME normaliser as the tiles
  const previewSrc = useMemo(
    () => ensureImageUrl(row.picture_url) ?? "",
    [row.picture_url]
  );

  useEffect(() => {
    let off = false;
    (async () => {
      if (!client) {
        setErr("Supabase client is not configured.");
        setLoading(false);
        return;
      }
      setErr(null);
      setLoading(true);
      try {
        if (!isCreate) {
          const { data, error } = await client
            .from("countries")
            .select("id,name,code,description,picture_url")
            .eq("id", params.id)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new Error("Country not found.");
          if (off) return;
          setRow(data as CountryRow);
        } else {
          // new record defaults
          setRow({
            id: "" as UUID,
            name: "",
            code: null,
            description: "",
            picture_url: "",
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
  }, [client, isCreate, params.id]);

  function update<K extends keyof CountryRow>(key: K, val: CountryRow[K]) {
    setRow((r) => ({ ...r, [key]: val }));
  }

  async function handleSave() {
    if (!client) return;
    setErr(null);
    try {
      const payload = {
        name: String(row.name || "").trim(),
        // keep code as-is (we’re not editing it here)
        code: row.code ?? null,
        description: row.description?.trim() || null,
        picture_url: row.picture_url?.trim() || null, // stored key or full URL
      };

      if (isCreate) {
        const { error } = await client.from("countries").insert(payload as any);
        if (error) throw error;
      } else {
        const { error } = await client
          .from("countries")
          .update(payload as any)
          .eq("id", params.id);
        if (error) throw error;
      }
      router.push("/admin/countries");
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  return (
    <div className="px-4 py-6 mx-auto max-w-3xl space-y-6">
      <header className="flex items-center gap-3">
        <button
          className="px-3 py-1 rounded-lg border hover:bg-neutral-50"
          onClick={() => router.back()}
        >
          ← Back
        </button>
        <h1 className="text-2xl font-semibold">
          {isCreate ? "New Country" : "Edit Country"}
        </h1>
      </header>

      {err && (
        <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      )}

      {loading ? (
        <div className="p-4 border rounded-xl bg-white shadow">Loading…</div>
      ) : (
        <div className="rounded-2xl border border-neutral-200 bg-white shadow overflow-hidden">
          <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: text fields */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Name</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.name}
                  onChange={(e) => update("name", e.target.value)}
                  placeholder="Antigua & Barbuda"
                />
              </label>

              {/* We keep code read-only here (if present) */}
              {row.code ? (
                <div className="text-xs text-neutral-600">
                  Code: <strong>{row.code}</strong>
                </div>
              ) : null}

              <label className="block text-sm">
                <span className="text-neutral-700">Description</span>
                <textarea
                  className="w-full mt-1 border rounded-lg px-3 py-2 min-h-[120px]"
                  value={row.description ?? ""}
                  onChange={(e) => update("description", e.target.value)}
                  placeholder="Optional description"
                />
              </label>
            </div>

            {/* Right: image field + preview */}
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-neutral-700">Picture URL or storage key</span>
                <input
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                  value={row.picture_url ?? ""}
                  onChange={(e) => update("picture_url", e.target.value)}
                  placeholder="images/countries/antigua-and-barbuda.jpg or full https URL"
                />
              </label>

              <div className="relative w-full overflow-hidden rounded-lg border bg-neutral-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt={row.name || "Country image"}
                    className="w-full h-48 object-cover"
                    onError={(e) => {
                      // fade the image if it fails so it doesn’t look broken
                      (e.currentTarget as HTMLImageElement).style.opacity = "0.3";
                    }}
                  />
                ) : (
                  <div className="h-48 w-full grid place-items-center text-xs text-neutral-500">
                    No image
                  </div>
                )}
              </div>
              <div className="text-xs text-neutral-600">
                Tip: for Supabase Storage keys, use
                {" "}
                <code>images/countries/&lt;file&gt;</code>
                {" "}— we’ll turn it into a full public URL automatically.
              </div>
            </div>
          </div>

          <div className="p-4 border-t flex items-center gap-2 justify-end">
            <button
              className="px-4 py-2 rounded-lg border hover:bg-neutral-50"
              onClick={() => router.back()}
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 rounded-lg text-white"
              style={{ backgroundColor: "#2563eb" }}
              onClick={handleSave}
            >
              {isCreate ? "Create Country" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
