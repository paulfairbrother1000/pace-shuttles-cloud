import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const basicAuth = req.headers.get("authorization");

  const USER = "dev";
  const PASS = "99"; // change this!

  if (basicAuth) {
    const [scheme, encoded] = basicAuth.split(" ");
    if (scheme === "Basic") {
      const [user, pass] = atob(encoded).split(":");
      if (user === USER && pass === PASS) {
        return NextResponse.next();
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

export const config = {
  matcher: ["/((?!_next|api|favicon.ico|robots.txt).*)"],
};
