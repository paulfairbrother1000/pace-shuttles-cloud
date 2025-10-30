// src/app/api/public/visible-catalog/route.ts
import { NextResponse } from "next/server";
import { getVisibleCatalog } from "@/server/homepage-catalog"; // <— adapter you’ll add below

export const dynamic = "force-dynamic"; // always fresh; let your internal loader control caching

export async function GET() {
  try {
    const catalog = await getVisibleCatalog();

    // Shape guardrails (don’t leak empty/undefined)
    const payload = {
      ok: true,
      routes: catalog?.routes ?? [],
      countries: catalog?.countries ?? [],
      destinations: catalog?.destinations ?? [],
      pickups: catalog?.pickups ?? [],
      vehicle_types: catalog?.vehicle_types ?? [],
    };

    // Light public cache; your loader can be stricter server-side
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60" },
    });
  } catch (err: any) {
    console.error("[visible-catalog] error:", err?.message || err);
    return NextResponse.json(
      { ok: false, error: "visible_catalog_failed" },
      { status: 500 }
    );
  }
}
