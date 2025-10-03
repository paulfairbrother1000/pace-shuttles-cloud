// src/lib/publicImage.ts
/**
 * Normalizes Supabase storage image references to an HTTPS URL on the *real* host.
 * Accepts:
 *  - keys like "countries/uk.jpg"
 *  - absolute URLs (incl. http://127.0.0.1:54321/... from the emulator)
 *  - app-relative "/foo.jpg" (passed through)
 */
export function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  // Keep app/public assets
  if (raw.startsWith("/")) return raw;

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");

  // Absolute URL? rewrite if it's local/emulator or a different host
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m && supaHost) {
        if (isLocal || u.hostname !== supaHost) {
          return `https://${supaHost}/storage/v1/object/public/${m[1]}`;
        }
        return raw; // already correct
      }
      return raw; // not a storage path
    } catch {
      // fall through
    }
  }

  // Treat as object key in the public bucket
  if (supaHost) {
    const key = raw.replace(/^\/+/, "");
    return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}`;
  }
  return undefined;
}
