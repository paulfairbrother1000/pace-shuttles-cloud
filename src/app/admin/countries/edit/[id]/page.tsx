// src/app/admin/countries/edit/[id]/page.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClient } from "@supabase/ssr";

/* NEW: shared header */
import TopBar from "@/components/Nav/TopBar";
import RoleSwitch from "@/components/Nav/RoleSwitch";

type UUID = string;

// Adjust if your bucket is named differently (e.g. "public")
const BUCKET = "images";                 // bucket name
const COUNTRY_DIR = "countries";         // folder within the bucket

type CountryRow = {
  id: UUID;
  name: string;
  code: string | null;
  description: string | null;
  picture_url: string | null; // may be a full https URL OR a storage key: "images/countries/file.jpg"
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

/* ---------- Helpers ---------- */
function ensureImageUrl(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;
  if (/^https?:\/\//i.test(raw)) return raw; // already absolute
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) return undefined;
  const key = raw.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${key}`;
}

function slugify(s: string) {
  return (s || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function extFromFilename(name: string) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "jpg";
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
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [err, setErr] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const [row, setRow] = useState<CountryRow>({
    id: "" as UUID,
    name: "",
    code: null,
    description: "",
    picture_url: "",
  });

  /* NEW: ps_user → header name + role switch visibility */
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
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  /* ---------- File upload handling ---------- */
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // NOTE: We keep this for programmatic uses if needed elsewhere,
  // but Safari/iOS may block .click() on display:none inputs.
  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    if (!client) return;
    setErr(null);
    setUploadMsg(null);

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setUploading(true);

      // Build a safe path: countries/<slug>-<ts>.<ext>
      const slug = slugify(row.name || "country");
      const ext = extFromFilename(file.name);
      const objectPath = `${COUNTRY_DIR}/${slug}-${Date.now()}.${ext}`;

      // Upload to bucket
      const { error: upErr } = await client.storage
        .from(BUCKET)
        .upload(objectPath, file, {
          cacheControl: "3600",
          upsert: true,
          contentType: file.type || `image/${ext}`,
        });

      if (upErr) throw upErr;

      // Store as storage key so tiles + ensureImageUrl work:
      const storageKey = `${BUCKET}/${objectPath}`;
      setRow((r) => ({ ...r, picture_url: storageKey }));
      setUploadMsg("Image uploaded. Preview updated.");

      // Clear file input so the same file can be re-picked if needed
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="min-h-screen">
      {/* NEW: sticky header (non-breaking) */}
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
          <div className="ml-auto flex items-center gap-2">
            <button
              className="px-4 py-2 rounded-lg text-white disabled:opacity-60"
              disabled={saving}
              style={{ backgroundColor: "#2563eb" }}
              onClick={handleSave}
            >
              {saving ? "Saving…" : isCreate ? "Create Country" : "Save Changes"}
            </button>
          </div>
        </header>

        {err && (
          <div className="p-3 border rounded-lg bg-rose-50 text-rose-700 text-sm">
            {err}
          </div>
        )}
        {uploadMsg && (
          <div className="p-3 border rounded-lg bg-emerald-50 text-emerald-700 text-sm">
            {uploadMsg}
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

              {/* Right: image field + preview + file picker */}
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

                {/* Choose file — Safari/iOS friendly (no display:none) */}
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
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      // Visually hidden but still clickable via label (not display:none)
                      className="absolute inset-0 w-px h-px opacity-0"
                      onChange={handleFilePicked}
                      disabled={uploading}
                    />
                  </div>
                  <span className="text-xs text-neutral-500">
                    Uploads to <code>{BUCKET}/{COUNTRY_DIR}</code> and fills the field above.
                  </span>
                </div>

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
                  Tip: Supabase Storage keys should look like{" "}
                  <code>{BUCKET}/{COUNTRY_DIR}/&lt;file&gt;</code>. We’ll turn it into a public URL automatically for previews and tiles.
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
                className="px-4 py-2 rounded-lg text-white disabled:opacity-60"
                style={{ backgroundColor: "#2563eb" }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : isCreate ? "Create Country" : "Save Changes"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
