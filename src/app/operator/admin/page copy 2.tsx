// src/app/operator/admin/page.tsx
"use client";

import * as React from "react";
import { createBrowserClient } from "@supabase/ssr";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Operator = { id: string; name: string | null; logo_url: string | null };

const BUCKET = "images";
const isHTTP = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveImageUrl(pathOrUrl: string | null) {
  if (!pathOrUrl) return null;
  if (isHTTP(pathOrUrl)) return pathOrUrl;
  const pub = supabase.storage.from(BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function OperatorAdminHome() {
  const [op, setOp] = React.useState<Operator | null>(null);
  const [logoUrl, setLogoUrl] = React.useState<string | null>(null);
  const [firstName, setFirstName] = React.useState("");

  React.useEffect(() => {
    let off = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) return;

      const metaFirst =
        (user.user_metadata?.first_name as string | undefined) ||
        (user.user_metadata?.given_name as string | undefined) ||
        (user.email ? user.email.split("@")[0] : "");
      if (metaFirst) setFirstName(metaFirst);

      // operator_id from cached header or DB
      let operatorId: string | null = null;
      try {
        const cached = JSON.parse(localStorage.getItem("ps_user") || "null");
        operatorId = cached?.operator_id ?? null;
        if (!metaFirst && cached?.first_name) setFirstName(String(cached.first_name));
      } catch {}

      if (!operatorId) {
        const { data } = await supabase
          .from("users")
          .select("operator_id, first_name")
          .eq("id", user.id)
          .maybeSingle();
        operatorId = data?.operator_id ?? null;
        if (!metaFirst && data?.first_name) setFirstName(String(data.first_name));
      }
      if (!operatorId) return;

      // operator row
      const { data: opRow } = await supabase
        .from("operators")
        .select("id,name,logo_url")
        .eq("id", operatorId)
        .maybeSingle();

      if (off) return;
      if (opRow) {
        setOp(opRow as Operator);
        setLogoUrl(await resolveImageUrl(opRow.logo_url ?? null));
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  return (
    <div className="space-y-6 p-4">
      {/* Hero only: logo + operator name */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 flex items-center gap-4">
        <div className="h-16 w-16 rounded-full border overflow-hidden bg-neutral-100 flex items-center justify-center">
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={op?.name ?? "Operator logo"}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xl font-semibold">
              {(op?.name ?? "A").slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div>
          <h2 className="text-2xl font-semibold">{op?.name ?? "Operator"}</h2>
          {firstName && (
            <p className="text-neutral-600">Welcome, {firstName}! Here’s your snapshot.</p>
          )}
        </div>
      </section>

      {/* Boards go right under the hero */}
      <JourneyBoardsInline operatorId={op?.id ?? null} />
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   INLINE BOARDS (no imports; avoids invalid element type issues)
   Reads: v_operator_journey_load, v_operator_unassigned_journeys
   ────────────────────────────────────────────────────────────────────────── */

function JourneyBoardsInline({ operatorId }: { operatorId: string | null }) {
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [loadRows, setLoadRows] = React.useState<any[]>([]);
  const [unassignedRows, setUnassignedRows] = React.useState<any[]>([]);

  React.useEffect(() => {
    let off = false;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        if (!operatorId) {
          setLoadRows([]);
          setUnassignedRows([]);
          return;
        }

        const [loadRes, unRes] = await Promise.all([
          supabase
            .from("v_operator_journey_load")
            .select("*")
            .eq("operator_id", operatorId)
            .order("journey_date", { ascending: true })
            .limit(50),
          supabase
            .from("v_operator_unassigned_journeys")
            .select("*")
            .eq("operator_id", operatorId)
            .order("journey_date", { ascending: true })
            .limit(50),
        ]);

        if (loadRes.error) throw loadRes.error;
        if (unRes.error) throw unRes.error;

        if (!off) {
          setLoadRows(loadRes.data ?? []);
          setUnassignedRows(unRes.data ?? []);
        }
      } catch (e: any) {
        if (!off) setErr(e?.message ?? "Failed to load boards.");
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => {
      off = true;
    };
  }, [operatorId]);

  return (
    <section className="rounded-2xl border bg-white p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xl font-semibold">Journey boards</h3>
        {!operatorId && <span className="text-sm text-neutral-500">No operator selected</span>}
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {loading && <div className="text-sm text-neutral-600">Loading…</div>}

      {!loading && !err && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <BoardCard
            title="Upcoming journeys (with vehicle)"
            subtitle="Shows paid seats vs capacity for vehicles you’ve assigned."
          >
            {loadRows.length === 0 ? (
              <Empty>No data.</Empty>
            ) : (
              <ul className="divide-y">
                {loadRows.map((r, i) => (
                  <Row key={i} row={r} mode="assigned" />
                ))}
              </ul>
            )}
          </BoardCard>

          <BoardCard
            title="Journeys needing assignment"
            subtitle="Paid seats exist but there’s no vehicle assigned yet."
          >
            {unassignedRows.length === 0 ? (
              <Empty>All set—no gaps.</Empty>
            ) : (
              <ul className="divide-y">
                {unassignedRows.map((r, i) => (
                  <Row key={i} row={r} mode="unassigned" />
                ))}
              </ul>
            )}
          </BoardCard>
        </div>
      )}
    </section>
  );
}

/* ── Presentational helpers ─────────────────────────────────────────────── */

function niceDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d.includes("T") ? d : d + "T12:00:00");
  return isNaN(+dt) ? d : dt.toLocaleDateString();
}
function journeyTitle(row: any) {
  const route = row?.route_name ?? row?.name ?? "Journey";
  const from = row?.pickup_name ?? row?.from_name ?? "";
  const to = row?.destination_name ?? row?.to_name ?? "";
  return from && to ? `${route} — ${from} → ${to}` : route;
}

function BoardCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-4">
      <div className="mb-3">
        <div className="text-lg font-medium">{title}</div>
        {subtitle && <div className="text-sm text-neutral-600">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-neutral-600">{children}</div>;
}

function Row({ row, mode }: { row: any; mode: "assigned" | "unassigned" }) {
  const date = row.journey_date ?? row.departure_date ?? row.date_iso ?? null;
  const booked = Number(row.booked_seats ?? row.paid_seats ?? row.qty ?? row.seats ?? 0);
  const cap = Number(row.capacity ?? row.seats_capacity ?? row.maxseats ?? 0);
  const vehicle = row.vehicle_name ?? row.name_vehicle ?? row.vehicle ?? "—";

  return (
    <li className="py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-medium">{journeyTitle(row)}</div>
          <div className="text-sm text-neutral-600">
            {niceDate(String(date))}
            {mode === "assigned" ? ` • Vehicle: ${vehicle}` : ""}
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold">
            {booked}
            {cap ? ` / ${cap}` : ""} seats
          </div>
          {mode === "unassigned" && (
            <div className="text-xs text-neutral-600">vehicle not assigned</div>
          )}
        </div>
      </div>
    </li>
  );
}
