// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * BASIC AUTH (Edge Middleware)
 * - Prompts browser login for any protected path
 * - Uses env vars: BASIC_AUTH_USER, BASIC_AUTH_PASS
 */

const USER = process.env.BASIC_AUTH_USER ?? "";
const PASS = process.env.BASIC_AUTH_PASS ?? "";

function isAuthorized(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;

  // Decode "Basic base64(user:pass)"
  const [, base64] = auth.split(" ");
  const [user, pass] = Buffer.from(base64, "base64").toString().split(":");
  return user === USER && pass === PASS;
}

export function middleware(req: NextRequest) {
  if (isAuthorized(req)) {
    return NextResponse.next();
  }

  // Ask the browser to show the login prompt
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Protected", charset="UTF-8"',
    },
  });
}

/**
 * Apply to everything EXCEPT static assets and public files.
 * Add more exceptions (e.g., webhooks) as needed.
 */
export const config = {
  matcher: [
    // Everything except:
    // - _next/static, _next/image
    // - public files: favicon, robots, sitemap, etc.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|apple-touch-icon.png|site.webmanifest).*)",
  ],
};
