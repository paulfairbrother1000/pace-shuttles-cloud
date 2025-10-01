// src/app/ops/page.tsx
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

/** ---- small helpers ---- */
function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}
function title(s?: string | null) {
  return s?.trim() || "—";
}

/** Row shape we expect from v_journey_vehicle_load */
type JVLoad = {
  id: string;
  route_id: string;
  journey_date: string; // YYYY-MM-DD
  vehicle_id: string;
  operator_id: string | null;

  // capacity and tally
  seats_capacity: number | null; // capacity for that vehicle on that day
  booked_seats: number | null;   // PAID seats only

  // thresholds / state
  min_seats: number | null;
  status: string | null; // active/cancelled/etc
};

type RouteRow = {
  id: string;
  route_name: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  transport_type: string | null;
};

type NameRow = { id: string; name: string | null };
type VehicleRow = { id: string; name: string | null };

export default async function OperatorDashboard() {
  /** 1) Server Supabase client */
  const jar = await cookies();
  const sb = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (n: string) => jar.get(n)?.value,
        set: (n, v, opts) => jar.set(n, v, opts),
        remove: (n, opts) => jar.set(n, "", { ...opts, maxAge: 0 }),
      },
    }
  );

  /** 2) Current user + operator context */
  const { data: s } = await sb.auth.getSession();
  const user = s?.session?.user;
  if (!user) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Operator dashboard</h1>
        <p className="mt-2 text-neutral-700">Please sign in to view this page.</p>
      </main>
    );
  }

  const { data: me } = await sb
    .from("users")
    .select("operator_admin, operator_id, first_name")
    .eq("id", user.id)
    .maybeSingle();

  const isOperatorAdmin = !!me?.operator_admin;
  const operatorId = me?.operator_id ?? null;

  if (!isOperatorAdmin || !operatorId) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Operator dashboard</h1>
        <p className="mt-2 text-neutral-700">
          Your account isn’t linked to an operator admin role.
        </p>
      </main>
    );
  }

  /** 3) Fetch JV load for next 30 days (read-only) */
  const today = new Date();
  const to = new Date();
  to.setDate(today.getDate() + 30);

  const { data: loads, error: loadErr } = await sb
    .from("v_journey_vehicle_load")
    .select(
      "id, route_id, journey_date, vehicle_id, operator_id, min_seats, seats_capacity, booked_seats, status"
    )
    .eq("operator_id", operatorId)
    .gte("journey_date", toISODate(today))
    .lte("journey_date", toISODate(to))
    .order("journey_date", { ascending: true });

  if (loadErr) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Operator dashboard</h1>
        <p className="mt-2 text-red-600">Failed to load journeys: {loadErr.message}</p>
      </main>
    );
  }

  const rows = (loads ?? []) as JVLoad[];
  if (rows.length === 0) {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold">Operator dashboard</h1>
        <p className="mt-2 text-neutral-700">No journeys in the next 30 days.</p>
      </main>
    );
  }

  /** 4) Hydrate names (routes / vehicles / pickup / destination) */
  const routeIds = [...new Set(rows.map((r) => r.route_id))];
  const vehicleIds = [...new Set(rows.map((r) => r.vehicle_id))];

  const [{ data: routes }, { data: vehicles }] = await Promise.all([
    routeIds.length
      ? sb
          .from("routes")
          .select("id, route_name, pickup_id, destination_id, transport_type")
          .in("id", routeIds)
      : Promise.resolve({ data: [] as RouteRow[] }),
    vehicleIds.length
      ? sb.from("vehicles").select("id, name").in("id", vehicleIds)
      : Promise.resolve({ data: [] as VehicleRow[] }),
  ]);

  const pickIds = [
    ...new Set((routes as RouteRow[]).map((r) => r.pickup_id).filter(Boolean) as string[]),
  ];
  const destIds = [
    ...new Set(
      (routes as RouteRow[]).map((r) => r.destination_id).filter(Boolean) as string[]
    ),
  ];

  const [{ data: pickups }, { data: dests }] = await Promise.all([
    pickIds.length ? sb.from("pickup_points").select("id, name").in("id", pickIds) : Promise.resolve({ data: [] as NameRow[] }),
    destIds.length ? sb.from("destinations").select("id, name").in("id", destIds) : Promise.resolve({ data: [] as NameRow[] }),
  ]);

  const routeById = new Map((routes as RouteRow[]).map((r) => [r.id, r]));
  const vehById = new Map((vehicles as VehicleRow[]).map((v) => [v.id, v.name || "Vehicle"]));
  const pickById = new Map((pickups as NameRow[]).map((p) => [p.id, p.name || "Pickup"]));
  const destById = new Map((dests as NameRow[]).map((d) => [d.id, d.name || "Destination"]));

  /** 5) Group (route_id + date) and compute tallies */
  type Group = {
    key: string;
    route_id: string;
    date: string;
    route_label: string;
    transport_type: string | null;
    min_required: number;
    capacity: number;
    taken: number;
    free: number;
    vehicles: Array<{ id: string; name: string; taken: number; cap: number; free: number }>;
  };

  const groups = new Map<string, Group>();

  for (const r of rows) {
    const cap = Number(r.seats_capacity ?? 0);
    const taken = Number(r.booked_seats ?? 0);
    const minSeats = Number(r.min_seats ?? 0);

    const route = routeById.get(r.route_id);
    const pick = route?.pickup_id ? pickById.get(route.pickup_id) : null;
    const dest = route?.destination_id ? destById.get(route.destination_id) : null;

    const routeLabel =
      title(route?.route_name) ||
      (pick || dest ? `${title(pick)} → ${title(dest)}` : "Route");

    const key = `${r.route_id}__${r.journey_date}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        route_id: r.route_id,
        date: r.journey_date,
        route_label: routeLabel,
        transport_type: route?.transport_type ?? null,
        min_required: 0,
        capacity: 0,
        taken: 0,
        free: 0,
        vehicles: [],
      });
    }

    const g = groups.get(key)!;
    g.min_required += minSeats;
    g.capacity += cap;
    g.taken += taken;
    g.free = g.capacity - g.taken;
    g.vehicles.push({
      id: r.id,
      name: vehById.get(r.vehicle_id) || "Vehicle",
      taken,
      cap,
      free: cap - taken,
    });
  }

  const all = [...groups.values()];
  const underConsideration = all.filter((g) => g.taken > 0 && g.taken < g.min_required);
  const confirmed = all.filter((g) => g.taken >= g.min_required);

  /** 6) Render (read-only) */
  return (
    <main className="p-6 space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Operator dashboard</h1>
        <p className="text-neutral-600">
          Showing journeys for the next 30 days for your operator.
        </p>
      </header>

      <Section title="Under consideration">
        {underConsideration.length === 0 ? (
          <Empty>Nothing under consideration right now.</Empty>
        ) : (
          <JourneyTable groups={underConsideration} />
        )}
      </Section>

      <Section title="Confirmed upcoming journeys">
        {confirmed.length === 0 ? (
          <Empty>No confirmed journeys yet.</Empty>
        ) : (
          <JourneyTable groups={confirmed} />
        )}
      </Section>
    </main>
  );
}

/** ---- tiny server components for structure (no interactivity) ---- */
function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold">{props.title}</h2>
      {props.children}
    </section>
  );
}
function Empty(props: { children: React.ReactNode }) {
  return <div className="text-sm text-neutral-600">{props.children}</div>;
}

function JourneyTable(props: {
  groups: Array<{
    key: string;
    route_label: string;
    transport_type: string | null;
    date: string;
    min_required: number;
    capacity: number;
    taken: number;
    free: number;
    vehicles: Array<{ id: string; name: string; taken: number; cap: number; free: number }>;
  }>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50">
          <tr>
            <th className="text-left p-3">Date</th>
            <th className="text-left p-3">Journey</th>
            <th className="text-left p-3">Type</th>
            <th className="text-left p-3">Vehicles (taken / cap)</th>
            <th className="text-left p-3">Taken</th>
            <th className="text-left p-3">Capacity</th>
            <th className="text-left p-3">Free</th>
            <th className="text-left p-3">Min seats</th>
          </tr>
        </thead>
        <tbody>
          {props.groups.map((g) => (
            <tr key={g.key} className="border-t">
              <td className="p-3">{new Date(g.date + "T12:00:00").toLocaleDateString()}</td>
              <td className="p-3">
                <div className="font-medium">{g.route_label}</div>
              </td>
              <td className="p-3">{g.transport_type ?? "—"}</td>
              <td className="p-3">
                <ul className="list-disc pl-5">
                  {g.vehicles.map((v) => (
                    <li key={v.id}>
                      {v.name}: {v.taken} / {v.cap} (free {v.free})
                    </li>
                  ))}
                </ul>
              </td>
              <td className="p-3">{g.taken}</td>
              <td className="p-3">{g.capacity}</td>
              <td className="p-3">{g.free}</td>
              <td className="p-3">{g.min_required}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
