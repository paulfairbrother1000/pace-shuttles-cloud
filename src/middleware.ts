// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Environment-driven switches/creds:
 * - ENABLE_BASIC_AUTH: "true" (default) or "false" to disable the prompt.
 * - BASIC_AUTH_USER:   username (default "dev")
 * - BASIC_AUTH_PASS:   password (default "99")
 * - BASIC_AUTH_REALM:  realm string (default "Development Site")
 *
 * Tip: If your browser seems stuck rejecting creds, change BASIC_AUTH_REALM to force a fresh prompt.
 */

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Never serve raw knowledge files from /public/knowledge/*
  //    (The ingest script reads from disk, this only blocks HTTP access.)
  if (pathname.startsWith("/knowledge/")) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // 2) Allow Next internals & API without auth (double-safety; matcher also exempts most)
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt"
  ) {
    return NextResponse.next();
  }

  // 3) Basic Auth gate (env-toggleable)
  const enableAuth =
    (process.env.ENABLE_BASIC_AUTH ?? "true").toLowerCase() !== "false";
  if (!enableAuth) {
    return NextResponse.next();
  }

  const USER = process.env.BASIC_AUTH_USER ?? "dev";
  const PASS = process.env.BASIC_AUTH_PASS ?? "99";
  const REALM = process.env.BASIC_AUTH_REALM ?? "Development Site";

  const header = req.headers.get("authorization");
  if (header) {
    const [scheme, encoded] = header.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        // Edge runtime provides atob
        const decoded = atob(encoded);
        const sep = decoded.indexOf(":");
        const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
        const pass = sep >= 0 ? decoded.slice(sep + 1) : "";
        if (user === USER && pass === PASS) {
          return NextResponse.next();
        }
      } catch {
        // fall through to 401
      }
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}"`,
    },
  });
}

// Exempt Next internals, API routes, and basic assets via matcher.
// NOTE: /knowledge/* is intentionally NOT exempted (blocked above).
export const config = {
  matcher: ["/((?!_next|api|favicon.ico|robots.txt).*)"],
};
