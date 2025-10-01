// src/app/admin/reports/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      )
    : null;

/* ===== Existing cards (unchanged) ===== */

function Card({ title, desc }: { title: string; desc: string }) {
  return (
    <article className="group rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:shadow-md">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium leading-tight">{title}</h2>
        <span className="rounded-full border px-2 py-0.5 text-xs text-neutral-600">Coming soon</span>
      </div>
      <p className="mb-4 text-sm text-neutral-600">{desc}</p>
      <div className="flex items-center gap-2">
        <button type="button" disabled className="inline-flex cursor-not-allowed items-center justify-center rounded-xl border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 opacity-70">View demo</button>
        <button type="button" disabled className="inline-flex cursor-not-allowed items-center justify-center rounded-xl border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-500 opacity-70">Export CSV</button>
      </div>
    </article>
  );
}

const mgmtReports = [
  { key: "country-performance", name: "Country Performance Benchmark", desc: "Revenue, seats sold, load factor, CSAT, refunds — compare countries with filters for season and lead-time." },
  { key: "journey-type-profitability", name: "Journey Type Profitability Matrix", desc: "Unit economics by journey type (e.g., shuttle, private charter) — RASM, break-even seats, margin%." },
  { key: "seasonal-trends", name: "Seasonal Trends by Month / Season", desc: "Month-over-month and season-over-season views for demand, price, utilisation, cancellations." },
  { key: "staff-leaderboard", name: "Staff Leaderboard (CSAT & Tips)", desc: "Rank captains/crew by CSAT, tips/seat, incident rate; drill into journeys for coaching." },
  { key: "csat-vs-tips", name: "CSAT ↔ Tips Correlation", desc: "Correlation: how service quality relates to gratuities and repeat rate across segments." },
  { key: "pickup-destination-benchmark", name: "Pickup ⇄ Destination Benchmark", desc: "Compare route pairs for conversion, price tolerance, cancellations, and net margin." },
  { key: "price-band-conversion", name: "Price Band vs Conversion (by Market)", desc: "Elasticity by country of origin and channel; sweet spots for pricing." },
  { key: "leadtime-sensitivity", name: "Lead-Time Sensitivity by Country & Journey Type", desc: "How booking window affects conversion, price realized, and no-show risk." },
  { key: "weather-adjusted-performance", name: "Weather-Adjusted Performance", desc: "Normalise KPIs (on-time, cancellations, CSAT) against weather/sea state to find true operator effect." },
  { key: "capacity-by-season-route", name: "Capacity & Utilisation by Season & Route", desc: "Seats offered vs sold, load factor, min-seats hit rate — detect where to add/remove capacity." },
  { key: "growth-scorecard-country", name: "Growth Scorecard by Country", desc: "Search volume, unserved demand, ROAS, forecast margin — rank markets for expansion." },
  { key: "channel-mix-country", name: "Channel Mix & ROI by Country", desc: "CAC, ROAS, blended CPA, assisted conversions — allocate spend to the highest-return geos." },
];

const operatorReports = [
  { key: "manifest", name: "Daily / Weekly Booking Manifest", desc: "Journeys, passengers, seat assignments by vehicle (printable)." },
  { key: "route-revenue", name: "Revenue by Route & Date", desc: "Earnings per route over time with filters and export." },
  { key: "seat-utilisation", name: "Seat Utilisation", desc: "% seats filled vs capacity by vehicle and route." },
  { key: "min-seats", name: "Min-Seats Threshold Achievement", desc: "How often journeys hit the minimum seat requirement." },
  { key: "cancels-noshow", name: "Cancellation & No-Show Analysis", desc: "Cancellations and no-shows by route and customer type." },
  { key: "ratings", name: "Customer Ratings & Feedback", desc: "CSAT/NPS linked to vehicles, crews, and routes." },
  { key: "cost-revenue", name: "Cost vs Revenue (Per Vehicle)", desc: "Combine running costs with earnings to see profitability." },
  { key: "maintenance", name: "Fleet Maintenance & Usage", desc: "Hours at sea vs maintenance schedules to reduce downtime." },
  { key: "settlement", name: "Operator Settlement", desc: "Fares collected, platform fees, and operator payouts." },
  { key: "repeat-vs-new", name: "Repeat vs New Customers", desc: "Loyalty and retention trends per operator." },
];

const destinationReports = [
  { key: "dest-demand", name: "Destination Demand & Conversion", desc: "Searches → quotes → bookings for each destination; identify high-intent, low-supply areas." },
  { key: "dest-revenue", name: "Revenue & Margin by Destination", desc: "Net revenue, margin%, refunds and cancellations by destination and season." },
  { key: "dest-csat", name: "Destination CSAT & Incident Rate", desc: "Service quality, complaints, and refund reasons clustered by destination." },
  { key: "dest-capacity", name: "Capacity & Utilisation by Destination", desc: "Seats offered vs sold, min-seats hit rate; spot capacity gaps." },
  { key: "dest-price-sensitivity", name: "Price Sensitivity by Destination", desc: "Conversion by price band and lead-time for each destination." },
];

/* ===== New: Applications list ===== */

type AppRow = {
  id: string;
  created_at: string;
  application_type: "operator" | "destination";
  status: "new" | "under_review" | "approved" | "declined";
  country_id: string | null;

  org_name: string | null;
  email: string | null;
  telephone: string | null;
  contact_name: string | null;

  transport_type_id: string | null;
  destination_type_id: string | null;
  fleet_size: number | null;

  // Name resolves (server supplies or we fetch maps once)
  country_name?: string | null;
  transport_type_name?: string | null;
  destination_type_name?: string | null;
};

const STATUS_OPTIONS = [
  { id: "all", label: "All statuses" },
  { id: "new", label: "New" },
  { id: "under_review", label: "Under review" },
  { id: "approved", label: "Approved" },
  { id: "declined", label: "Declined" },
] as const;

function useApplications() {
  const [rows, setRows] = useState<AppRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]["id"]>("all");
  const [typeFilter, setTypeFilter] = useState<"all"|"operator"|"destination">("all");
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (typeFilter !== "all") params.set("application_type", typeFilter);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/partner-applications?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || `Load failed (${res.status})`);
      setRows(json.items || []);
    } catch (e: any) {
      setError(e?.message || "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []); // initial

  return { rows, loading, error, load, status, setStatus, typeFilter, setTypeFilter, q, setQ };
}

function ApplicationsTab() {
  const { rows, loading, error, load, status, setStatus, typeFilter, setTypeFilter, q, setQ } = useApplications();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function setAppStatus(id: string, newStatus: AppRow["status"]) {
    try {
      setBusyId(id);
      const res = await fetch("/api/admin/partner-applications/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || `Update failed (${res.status})`);
      await load();
    } catch (e) {
      alert((e as any)?.message || "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => rows, [rows]);

  return (
    <section className="space-y-3">
      <div className="rounded-2xl border bg-white p-3 flex flex-wrap items-center gap-2">
        <select className="rounded-lg border px-2 py-1 text-sm" value={status} onChange={(e) => setStatus(e.target.value as any)}>
          {STATUS_OPTIONS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <select className="rounded-lg border px-2 py-1 text-sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as any)}>
          <option value="all">All types</option>
          <option value="operator">Operators</option>
          <option value="destination">Destinations</option>
        </select>
        <input
          className="rounded-lg border px-2 py-1 text-sm min-w-[220px]"
          placeholder="Search org/contact/email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50" onClick={load}>Apply</button>
        <button className="ml-auto rounded-lg border px-3 py-1.5 text-sm hover:bg-neutral-50" onClick={load}>Refresh</button>
      </div>

      <div className="rounded-2xl border bg-white overflow-auto">
        {loading ? (
          <div className="p-4">Loading…</div>
        ) : error ? (
          <div className="p-4 text-amber-700">Error: {error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-4">No applications found.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left p-3 w-[120px]">Submitted</th>
                <th className="text-left p-3">Org / Contact</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Country</th>
                <th className="text-left p-3">Extra</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3 w-[180px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t align-top">
                  <td className="p-3">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-3">
                    <div className="font-medium">{r.org_name ?? "—"}</div>
                    <div className="text-neutral-600">
                      {(r.contact_name || r.email || r.telephone) ? (
                        <>
                          {r.contact_name && <span>{r.contact_name}</span>}
                          {r.contact_name && (r.email || r.telephone) && <span> · </span>}
                          {r.email && <span>{r.email}</span>}
                          {r.email && r.telephone && <span> · </span>}
                          {r.telephone && <span>{r.telephone}</span>}
                        </>
                      ) : "—"}
                    </div>
                  </td>
                  <td className="p-3 capitalize">{r.application_type}</td>
                  <td className="p-3">{r.country_name ?? "—"}</td>
                  <td className="p-3">
                    {r.application_type === "operator" ? (
                      <div>
                        <div><span className="text-neutral-500">Vehicle:</span> {r.transport_type_name ?? "—"}</div>
                        <div><span className="text-neutral-500">Fleet:</span> {r.fleet_size ?? "—"}</div>
                      </div>
                    ) : (
                      <div>
                        <div><span className="text-neutral-500">Dest. type:</span> {r.destination_type_name ?? "—"}</div>
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span className="rounded-full border px-2 py-0.5 text-xs">{r.status.replace("_"," ")}</span>
                  </td>
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-2">
                      <button
                        className="rounded-lg border px-2 py-1 hover:bg-neutral-50"
                        disabled={busyId === r.id}
                        onClick={() => setAppStatus(r.id, "under_review")}
                      >
                        Under review
                      </button>
                      <button
                        className="rounded-lg border px-2 py-1 hover:bg-neutral-50"
                        disabled={busyId === r.id}
                        onClick={() => setAppStatus(r.id, "approved")}
                      >
                        Approve
                      </button>
                      <button
                        className="rounded-lg border px-2 py-1 hover:bg-neutral-50"
                        disabled={busyId === r.id}
                        onClick={() => setAppStatus(r.id, "declined")}
                      >
                        Decline
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* ===== Page wrapper with tabs ===== */

export default function ManagementReportsPage() {
  const tabs = [
    { id: "applications", label: "Applications" },   // NEW
    { id: "mgmt", label: "Management" },
    { id: "operators", label: "Operators" },
    { id: "destinations", label: "Destinations" },
  ] as const;
  type TabId = typeof tabs[number]["id"];
  const [tab, setTab] = useState<TabId>("applications"); // default to Applications

  const operatorOptions = [
    { id: "all", name: "All Operators" },
    { id: "op-aurora", name: "Aurora Charters" },
    { id: "op-coral", name: "Coral Boats" },
    { id: "op-pelican", name: "Pelican Marine" },
  ];
  const [operatorId, setOperatorId] = useState("all");

  function TabBar() {
    return (
      <div className="mb-4 flex items-center gap-2 overflow-x-auto rounded-2xl border border-neutral-200 bg-white p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              "whitespace-nowrap rounded-xl px-3 py-1.5 text-sm font-medium transition " +
              (tab === t.id ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100")
            }
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          {tab === "operators" && (
            <label className="flex items-center gap-2 text-sm text-neutral-600">
              <span>Operator:</span>
              <select
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1 text-sm"
                value={operatorId}
                onChange={(e) => setOperatorId(e.target.value)}
              >
                {operatorOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    );
  }

  function Grid({ items }: { items: { key: string; name: string; desc: string }[] }) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((r) => (
          <Card key={r.key} title={r.name} desc={r.desc} />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Admin Reports</h1>
        <p className="text-sm text-neutral-500">Review partner applications and explore analytics.</p>
      </header>

      <TabBar />

      {tab === "applications" && <ApplicationsTab />}

      {tab === "mgmt" && (
        <section className="mt-6">
          <h2 className="sr-only">Management</h2>
          <Grid items={mgmtReports} />
        </section>
      )}

      {tab === "operators" && (
        <section className="mt-6">
          <h2 className="sr-only">Operators</h2>
          <div className="mb-3 text-sm text-neutral-600">Showing reports for: <span className="font-medium">Operator context placeholder</span></div>
          <Grid items={operatorReports} />
        </section>
      )}

      {tab === "destinations" && (
        <section className="mt-6">
          <h2 className="sr-only">Destinations</h2>
          <Grid items={destinationReports} />
        </section>
      )}
    </div>
  );
}
