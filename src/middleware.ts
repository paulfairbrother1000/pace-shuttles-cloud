// src/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1) Never serve raw knowledge files from /public/knowledge/*
  //    (ingest reads from disk; this only blocks HTTP access)
  if (pathname.startsWith("/knowledge/")) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // 2) Optional: Basic Auth gate for the whole site (except exempted paths)
  //    Toggle with env ENABLE_BASIC_AUTH=true|false (default true)
  const enableAuth =
    (process.env.ENABLE_BASIC_AUTH ?? "true").toLowerCase() !== "false";

  if (!enableAuth) {
    return NextResponse.next();
  }

  const basicAuth = req.headers.get("authorization");
  const USER = process.env.BASIC_AUTH_USER ?? "dev";
  const PASS = process.env.BASIC_AUTH_PASS ?? "99"; // change in env for security

  if (basicAuth) {
    const [scheme, encoded] = basicAuth.split(" ");
    if (scheme === "Basic" && encoded) {
      try {
        const decoded = atob(encoded);
        const [user, pass] = decoded.split(":");
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
      "WWW-Authenticate": 'Basic realm="Development Site"',
    },
  });
}

// Exempt Next internals, API routes, basic assets.
// NOTE: /knowledge/* is NOT exempted (intentionally blocked above).
export const config = {
  matcher: ["/((?!_next|api|favicon.ico|robots.txt).*)"],
};
