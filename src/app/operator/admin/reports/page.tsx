// app/operator/admin/reports/page.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";
import ReportView from "@/components/ReportView";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type ReportCard = {
  key: string;
  name: string;
  desc: string;
  enabled?: boolean;
  slug?: string;
};

export default function OperatorReportsPage() {
  // role detection
  const [loadingRole, setLoadingRole] = React.useState(true);
  const [isSiteAdmin, setIsSiteAdmin] = React.useState(false);
  const [isOperatorAdmin, setIsOperatorAdmin] = React.useState(false);
  const [operatorId, setOperatorId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        const { data: s } = await sb.auth.getSession();
        const uid = s?.session?.user?.id;
        if (!uid) {
          if (!off) setLoadingRole(false);
          return;
        }
        const { data, error } = await sb
          .from("users")
          .select("site_admin, operator_admin, operator_id")
          .eq("id", uid)
          .maybeSingle();
        if (error) throw error;
        if (off) return;
        setIsSiteAdmin(!!data?.site_admin);
        setIsOperatorAdmin(!!data?.operator_admin);
        setOperatorId(data?.operator_id ?? null);
      } catch {
        // fall through to loading=false; ReportView will still render, and API will return useful errors
      } finally {
        if (!off) setLoadingRole(false);
      }
    })();
    return () => { off = true; };
  }, []);

  const reports: ReportCard[] = [
    { key: "manifest", name: "Daily / Weekly Booking Manifest", desc: "Journeys, passengers, seat assignments by vehicle (printable)." },
    { key: "route-revenue", name: "Revenue by Route & Date", desc: "Earnings per route over time with filters and export.", enabled: true, slug: "revenue_by_route_date" },
    { key: "seat-utilisation", name: "Seat Utilisation", desc: "% seats filled vs capacity by vehicle and route.", enabled: true, slug: "seat_utilisation" },
    { key: "min-seats", name: "Min-Seats Threshold Achievement", desc: "How often journeys hit the minimum seat requirement.", enabled: true, slug: "min_seats" },
    { key: "cancels-noshow", name: "Cancellation & No-Show Analysis", desc: "Cancellations and no-shows by route and customer type." },
    { key: "ratings", name: "Customer Ratings & Feedback", desc: "CSAT/NPS linked to vehicles, crews, and routes." },
    { key: "cost-revenue", name: "Cost vs Revenue (Per Vehicle)", desc: "Combine running costs with earnings to see profitability." },
    { key: "maintenance", name: "Fleet Maintenance & Usage", desc: "Hours at sea vs maintenance schedules to reduce downtime." },
    { key: "settlement", name: "Operator Settlement", desc: "Fares collected, platform fees, and operator payouts.", enabled: true, slug: "operator_settlement" },
    { key: "repeat-vs-new", name: "Repeat vs New Customers", desc: "Loyalty and retention trends per operator." },
  ];

  const firstEnabled = reports.find(r => r.enabled && r.slug)?.slug || "revenue_by_route_date";
  const [activeSlug, setActiveSlug] = React.useState<string>(firstEnabled);

  const handleOpen = (slug?: string) => {
    if (!slug) return;
    setActiveSlug(slug);
    document.getElementById("report-viewer")?.scrollIntoView({ behavior: "smooth" });
  };

  // Decide how to mount ReportView:
  // - Operator admin: siteAdmin={false} (operator implied by RLS)
  // - Site admin: siteAdmin={true} (show operator selector, seed with operatorId if present)
  const viewerSiteAdmin = isSiteAdmin && !isOperatorAdmin;
  const viewerDefaultOperatorId = viewerSiteAdmin ? operatorId : null;

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <header className="mb-2">
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-neutral-500">
          Operator view — live data for enabled reports. You can filter and export CSV below.
        </p>
      </header>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => {
          const disabled = !r.enabled;
          return (
            <article key={r.key} className="group rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:shadow-md">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="text-base font-medium leading-tight">{r.name}</h2>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${disabled ? "text-neutral-600" : "text-emerald-700 border-emerald-300"}`}>
                  {disabled ? "Coming soon" : "Live"}
                </span>
              </div>
              <p className="mb-4 text-sm text-neutral-600">{r.desc}</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleOpen(r.slug)}
                  disabled={disabled}
                  className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 text-xs font-medium ${
                    disabled ? "cursor-not-allowed border-neutral-300 text-neutral-500 opacity-70" : "border-neutral-700 text-neutral-900 hover:bg-neutral-50"
                  }`}
                >
                  {disabled ? "View demo" : "Open"}
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (disabled) return;
                    document.getElementById("report-viewer")?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className={`inline-flex items-center justify-center rounded-xl border px-3 py-1.5 text-xs font-medium ${
                    disabled ? "cursor-not-allowed border-neutral-300 text-neutral-500 opacity-70" : "border-neutral-700 text-neutral-900 hover:bg-neutral-50"
                  }`}
                >
                  Export CSV
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {/* Live viewer */}
      <section id="report-viewer" className="rounded-2xl border p-4 bg-white shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Report Viewer</h2>
          {!loadingRole && viewerSiteAdmin ? (
            <div className="text-sm text-neutral-500">
              Site admin mode — enter an Operator ID to run the report.
            </div>
          ) : (
            <div className="text-sm text-neutral-500">
              Operator is implied by your login (no selector shown).
            </div>
          )}
        </div>

        {/* Optional nudge for site-admins without an operator_id */}
        {!loadingRole && viewerSiteAdmin && !viewerDefaultOperatorId && (
          <div className="mb-3 text-sm text-amber-700">
            You’re signed in as a site admin. Enter an <span className="font-medium">Operator ID</span> in the viewer below to run a report.
          </div>
        )}

        {/* Mount the viewer with correct mode */}
        <ReportView
          key={activeSlug + String(viewerSiteAdmin)}  // force remount if mode flips
          siteAdmin={viewerSiteAdmin}
          defaultOperatorId={viewerDefaultOperatorId}
          initialSlug={activeSlug as any}
        />
      </section>
    </div>
  );
}
