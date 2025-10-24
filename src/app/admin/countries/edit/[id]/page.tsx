"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* Header bits */
import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";

type UUID = string;

// Storage config
const BUCKET = "images";
const COUNTRY_DIR = "countries";

// DB row
type CountryRow = {
  id: UUID;
  name: string;
  code: string | null;
  description: string | null;
  picture_url: string | null; // may be full https URL or a storage key "images/countries/..."
};

/* ---------- Supabase client (browser only) ---------- */
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
  // treat as storage key (bucket/path...)
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return undefined;
  const key = raw.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${key}`;
}

/* ---------- Tiny helpers for upload naming (matches vehicles style) ---------- */
function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function extFromFilename(name: string) {
  const m = name.match(/\.([a-z0-9]+)$/i);
  return (m?.[1] || "jpg").toLowerCase();
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

  // header bits
  const [headerName, setHeaderName] = useState<string | null>(null);
  const [hasBothRoles, setHasBothRoles] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      if (raw) {
        const u = JSON.parse(raw);
        const display =
          u?.name ||
          u?.operator_name ||
          [u?.first_name, u?.last_name].filter(Boolean).join(" ") ||
          null;
        setHeaderName(display);
        setHasBothRoles(!!(u?.site_admin && u?.operator_admin));
      }
    } catch {
      /* ignore */
    }
  }, []);

  // preview uses exact same normaliser as tiles
  const previewSrc = useMemo(
    () => ensureImageUrl(row.picture_url) ?? "",
    [row.picture_url]
  );

  /* ---------- Initial load ---------- */
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

  /* ---------- Save ---------- */
  async function handleSave() {
    if (!client) return;
    setErr(null);
    try {
      const payload = {
        name: String(row.name || "").trim(),
        code: row.code ?? null,
        description: row.description?.trim() || null,
        // store the storage key or full URL exactly as typed/filled
        picture_url: row.picture_url?.trim() || null,
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

  /* ---------- Upload (vehicles-style: no refs; reset via event) ---------- */
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
  if (!client) return;
  setErr(null);
  setUploadMsg(null);

  const inputEl = e.currentTarget; // <- capture synchronously
  const file = inputEl.files?.[0];
  if (!file) return;

  // Basic guards (client-side)
  const MAX_MB = 8;
  if (!file.type.startsWith("image/")) {
    setErr("Please choose an image file.");
    try { inputEl.value = ""; } catch {}
    return;
  }
  if (file.size > MAX_MB * 1024 * 1024) {
    setErr(`Image is too large (max ${MAX_MB}MB).`);
    try { inputEl.value = ""; } catch {}
    return;
  }

  try {
    setUploading(true);

    // Build path: countries/<slug>-<ts>.<ext>
    const slug = slugify(row.name || "country");
    const ext = extFromFilename(file.name);
    const objectPath = `${COUNTRY_DIR}/${slug}-${Date.now()}.${ext}`;

    // Upload
    const { error: upErr } = await client.storage
      .from(BUCKET)
      .upload(objectPath, file, {
        cacheControl: "3600",
        upsert: true,
        contentType: file.type || `image/${ext}`,
      });
    if (upErr) throw upErr;

    // Persist storage key (same format you expect)
    const storageKey = `${BUCKET}/${objectPath}`;
    setRow((r) => ({ ...r, picture_url: storageKey }));
    setUploadMsg("Image uploaded. Preview updated.");
  } catch (e: any) {
    setErr(e?.message ?? String(e));
  } finally {
    setUploading(false);
    // Clear input safely (if still mounted)
    try { inputEl.value = ""; } catch {}
  }
}

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen">
      <TopBar userName={headerName} homeHref="/" accountHref="/login" />
      <RoleSwitch active="site" show={hasBothRoles} />

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

                {/* Choose file (label-for; works on iOS/Safari) */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <label
                      htmlFor="country-file-input"
                      className="px-3 py-2 rounded-lg border hover:bg-neutral-50 cursor-pointer inline-block select-none"
                    >
                      {uploading ? "Uploading…" : "Choose file & upload"}
                    </label>
                    <input
                      id="country-file-input"
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 w-px h-px opacity-0"
                      onChange={handleFilePicked}
                      disabled={uploading}
                    />
                  </div>
                  <span className="text-xs text-neutral-500">
                    Uploads to <code>{BUCKET}/{COUNTRY_DIR}</code> and fills the field above.
                  </span>
                </div>

                {uploadMsg && (
                  <div className="text-xs text-emerald-600">{uploadMsg}</div>
                )}

                <div className="relative w-full overflow-hidden rounded-lg border bg-neutral-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {previewSrc ? (
                    <img
                      src={previewSrc}
                      alt={row.name || "Country image"}
                      className="w-full h-48 object-cover"
                      onError={(e) => {
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
                  Tip: Storage keys should look like{" "}
                  <code>{BUCKET}/{COUNTRY_DIR}/&lt;file&gt;</code>. We’ll convert keys to public URLs for preview automatically.
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
  disabled={uploading}
>
  {isCreate ? "Create Country" : "Save Changes"}
</button>

            </div>
          </div>
        )}
      </div>
    </div>
  );
}
