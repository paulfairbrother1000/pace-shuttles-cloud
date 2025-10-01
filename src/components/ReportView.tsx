// src/components/ReportView.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ----------------------------- Types & props ----------------------------- */

type Props = {
  /** Show operator selector + require operator_id (site admin view). */
  siteAdmin?: boolean;
  /** Optional seed for operator selector (site admin view). */
  defaultOperatorId?: string | null;
  /** Initial report to show. */
  initialSlug?:
    | "revenue_by_route_date"
    | "seat_utilisation"
    | "min_seats"
    | "operator_settlement";
};

type Operator = { id: string; name: string };

/* ----------------------------- Supabase client ----------------------------- */

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ----------------------------- Date helpers ----------------------------- */

/** Format an ISO timestamp into the input-friendly `YYYY-MM-DDTHH:mm` (local). */
const toInputFromIso = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
};

/** Parse a `datetime-local` *local* value and return a safe ISO (UTC) string. */
const isoFromInputLocal = (value: string) => {
  if (!value) return new Date().toISOString();
  const [datePart, timePart = "00:00"] = value.split("T");
  const [y, m, d] = (datePart || "").split("-").map((n) => parseInt(n, 10));
  const [hh, mm] = (timePart || "").split(":").map((n) => parseInt(n, 10));
  const dt = new Date(
    Number.isFinite(y) ? y : new Date().getFullYear(),
    Number.isFinite(m) ? m - 1 : 0,
    Number.isFinite(d) ? d : 1,
    Number.isFinite(hh) ? hh : 0,
    Number.isFinite(mm) ? mm : 0,
    0,
    0
  );
  return dt.toISOString();
};

/* ----------------------------- Render helpers ----------------------------- */

const titleise = (s: string) =>
  s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const gbp = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(
    n
  );

const prettyDate = (v: any) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v ?? "—") : d.toLocaleString("en-GB");
};

/** Human presentation for table cells (hide nulls, add %, format £ columns). */
function prettyCell(header: string, value: any) {
  if (value == null) return "—";
  const h = header.toLowerCase();

  // Datetime
  if (h === "departure_ts" || h.endsWith("_ts")) {
    return prettyDate(value);
  }

  // Percent-like columns: utilisation, *_pct, pct_of_min, met_pct, percent_met
  if (h === "utilisation" || /(_pct$|_percent$|pct_of|min_pct$|percent_met$)/.test(h)) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return Number.isInteger(num) ? `${num}%` : `${num.toFixed(1)}%`;
  }

  // Money in pounds (already whole numbers), e.g. base_gbp, tax_gbp, total_gbp
  if (/_gbp$/.test(h)) {
    const num = Number(value);
    return Number.isFinite(num) ? gbp(num) : String(value);
  }

  return String(value);
}

/* ----------------------------- API helpers ----------------------------- */

const fetchReport = async (slug: string, qs: Record<string, string>) => {
  const p = new URLSearchParams(qs).toString();
  const res = await fetch(`/api/reports/${slug}?${p}`, { cache: "no-store" });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Request failed (${res.status})`);
  }
  const j = await res.json();
  return (j.rows as any[]) || [];
};

/* ----------------------------- Component ----------------------------- */

export default function ReportView({
  siteAdmin = false,
  defaultOperatorId = null,
  initialSlug = "seat_utilisation",
}: Props) {
  // report selection
  const [slug, setSlug] = React.useState<string>(initialSlug);

  // date range (ISO)
  const [from, setFrom] = React.useState<string>(
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  );
  const [to, setTo] = React.useState<string>(
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  );

  // operator (site admin only) OR current operator for operator-admin users
  const [operatorId, setOperatorId] = React.useState<string | null>(defaultOperatorId);
  const [selfOperatorId, setSelfOperatorId] = React.useState<string | null>(null);

  const [operators, setOperators] = React.useState<Operator[]>([]);
  const [opsLoading, setOpsLoading] = React.useState<boolean>(false);
  const [opsErr, setOpsErr] = React.useState<string | null>(null);

  // Load operators for site admin dropdown
  React.useEffect(() => {
    if (!siteAdmin) return;
    let off = false;
    (async () => {
      try {
        setOpsLoading(true);
        setOpsErr(null);
        const { data, error } = await sb.from("operators").select("id,name").order("name");
        if (error) throw error;
        if (!off) setOperators((data as Operator[]) || []);
      } catch (e: any) {
        if (!off) setOpsErr(e?.message || "Failed to load operators.");
      } finally {
        if (!off) setOpsLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [siteAdmin]);

  // For operator-admin users, find their operator_id so we can call the summary RPC
  React.useEffect(() => {
    if (siteAdmin) return;
    let off = false;
    (async () => {
      try {
        const { data: s } = await sb.auth.getSession();
        const uid = s?.session?.user?.id;
        if (!uid) return;
        const { data } = await sb.from("users").select("operator_id").eq("id", uid).maybeSingle();
        if (!off) setSelfOperatorId(data?.operator_id ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      off = true;
    };
  }, [siteAdmin]);

  // data
  const [rows, setRows] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState<boolean>(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Min-seats period summary (percent_met, etc.)
  const [minSeatsSummary, setMinSeatsSummary] = React.useState<any | null>(null);

  const rawHeaders = rows.length ? Object.keys(rows[0]) : [];
  // hide any *_id columns by default
  const headers = rawHeaders.filter((h) => !/_id$/i.test(h));

  const canRun = siteAdmin ? !!operatorId : true;

  const run = React.useCallback(async () => {
    if (!canRun) return;
    try {
      setLoading(true);
      setErr(null);
      setMinSeatsSummary(null);

      const opId = siteAdmin ? operatorId : selfOperatorId;

      const data = await fetchReport(slug, {
        from,
        to,
        ...(siteAdmin ? { operator_id: operatorId || "" } : {}),
      });
      setRows(data);

      // Min-Seats period summary banner
      if (slug === "min_seats" && opId) {
        const { data: summary, error: sumErr } = await sb.rpc("rpt_min_seats_summary_v1", {
          p_operator: opId,
          p_from: from,
          p_to: to,
        });
        if (!sumErr && Array.isArray(summary) && summary.length) {
          setMinSeatsSummary(summary[0]);
        } else {
          setMinSeatsSummary(null);
        }
      } else {
        setMinSeatsSummary(null);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load report.");
      setRows([]);
      setMinSeatsSummary(null);
    } finally {
      setLoading(false);
    }
  }, [slug, from, to, operatorId, selfOperatorId, siteAdmin, canRun]);

  // auto-run on report change
  React.useEffect(() => {
    if (canRun) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const onExportCsv = React.useCallback(() => {
    if (!canRun) return;
    const qs = new URLSearchParams({
      from,
      to,
      ...(siteAdmin ? { operator_id: operatorId || "" } : {}),
      format: "csv",
    }).toString();
    window.location.href = `/api/reports/${slug}?${qs}`;
  }, [slug, from, to, operatorId, siteAdmin, canRun]);

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="text-xs block">Report</label>
          <select
            className="border rounded px-2 py-1"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          >
            <option value="seat_utilisation">Seat Utilisation</option>
            <option value="min_seats">Min-Seats Threshold</option>
            <option value="revenue_by_route_date">Revenue by Route &amp; Date</option>
            <option value="operator_settlement">Operator Settlement</option>
          </select>
        </div>

        <div>
          <label className="text-xs block">From</label>
          <input
            className="border rounded px-2 py-1"
            type="datetime-local"
            value={toInputFromIso(from)}
            onChange={(e) => setFrom(isoFromInputLocal(e.target.value))}
          />
        </div>

        <div>
          <label className="text-xs block">To</label>
          <input
            className="border rounded px-2 py-1"
            type="datetime-local"
            value={toInputFromIso(to)}
            onChange={(e) => setTo(isoFromInputLocal(e.target.value))}
          />
        </div>

        {siteAdmin && (
          <div className="min-w-[280px]">
            <label className="text-xs block">Operator</label>
            <select
              className="border rounded px-2 py-1 w-full"
              value={operatorId || ""}
              onChange={(e) => setOperatorId(e.target.value || null)}
              disabled={opsLoading}
            >
              <option value="">
                {opsLoading ? "Loading operators…" : "— Select operator —"}
              </option>
              {operators.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {opsErr && <div className="text-xs text-red-600 mt-1">{opsErr}</div>}
          </div>
        )}

        <button
          className="border rounded px-3 py-1 disabled:opacity-50"
          onClick={run}
          disabled={!canRun}
        >
          Run
        </button>

        <button
          className="border rounded px-3 py-1 disabled:opacity-50"
          onClick={onExportCsv}
          disabled={!canRun}
        >
          Export CSV
        </button>
      </div>

      {/* Site admin hint */}
      {siteAdmin && !operatorId && (
        <div className="text-sm text-amber-700">
          You’re signed in as a site admin. Choose an operator to run a report.
        </div>
      )}

      {/* Min-Seats summary banner */}
      {slug === "min_seats" && minSeatsSummary?.percent_met != null && (
        <div className="text-sm rounded border px-3 py-2 bg-emerald-50 border-emerald-200">
          <strong>Period met:</strong>{" "}
          {prettyCell("percent_met", minSeatsSummary.percent_met)}
          {minSeatsSummary.journeys_total != null && (
            <>
              {" "}
              · Journeys: {minSeatsSummary.journeys_met ?? "—"}/
              {minSeatsSummary.journeys_total}
            </>
          )}
        </div>
      )}

      {/* Messages */}
      {err && <div className="text-sm text-red-600">{err}</div>}

      {/* Results */}
      {loading ? (
        <div className="text-sm text-neutral-600">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-neutral-500">No rows.</div>
      ) : (
        <div className="overflow-auto border rounded">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="text-left p-2 border">
                    {titleise(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t">
                  {headers.map((h) => (
                    <td key={h} className="p-2 border">
                      {prettyCell(h, r[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
