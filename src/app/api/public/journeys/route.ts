// ...existing imports and runtime
export async function GET(req: Request) {
  const url = new URL(req.url);
  const countryId = url.searchParams.get("country_id");
  const pickupId = url.searchParams.get("pickup_id");
  const destinationId = url.searchParams.get("destination_id");
  const date = url.searchParams.get("date");
  const activeParam = url.searchParams.get("active");
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const supa = supaAnon();
  let query = supa
    .from("ps_public_journeys_v")
    .select("*", { count: "exact" })
    .order("starts_at", { ascending: true, nullsFirst: false })
    .range(offset, offset + limit - 1);

  if (countryId) query = query.eq("country_id", countryId);
  if (pickupId) query = query.eq("pickup_id", pickupId);
  if (destinationId) query = query.eq("destination_id", destinationId);
  if (activeParam !== null) query = query.eq("active", activeParam === "true");
  if (date) {
    const startISO = `${date}T00:00:00Z`;
    const endISO   = `${date}T23:59:59Z`;
    query = query.gte("starts_at", startISO).lte("starts_at", endISO);
  }
  if (q) {
    const safe = q.replace(/[%_]/g, s => `\\${s}`);
    query = query.or(`pickup_name.ilike.%${safe}%,destination_name.ilike.%${safe}%,country_name.ilike.%${safe}%`);
  }

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 });

  // Strip raw IDs before responding
  const rows = (data ?? []).map(({ 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    id, route_id, country_id, pickup_id, destination_id, base_price_cents, ...rest
  }) => rest);

  return NextResponse.json(
    { ok: true, rows, count: count ?? 0 },
    { headers: { "Cache-Control": "s-maxage=120, stale-while-revalidate=3600" } }
  );
}
