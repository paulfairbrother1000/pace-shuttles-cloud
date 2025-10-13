"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

/* ---------- Supabase (browser) ---------- */
const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

/* ---------- Feature flag ---------- */
function crewOpsEnabled() {
  return String(process.env.NEXT_PUBLIC_CREW_OPS_ENABLED).toLowerCase() === "true";
}

/* ---------- Identity (RPC) ---------- */
type Identity = {
  isCrew: boolean;
  staffId: string | null;
  operatorId: string | null;
  roleLabel: string | null;
};

/* ---------- Crew view types ---------- */
type AssignRow = {
  assignment_id: UUID;
  journey_id: UUID;
  vehicle_id: UUID;
  staff_id: UUID;
  staff_user_id: UUID;
  role_id: UUID | null;
  status_simple: "allocated" | "confirmed" | "complete";
  assigned_at: string | null;
  confirmed_at: string | null;
  created_at: string;

  // identity/timing from v_crew_assignments_min
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  role_label: string | null;
  departure_ts: string | null;

  // labels from the view
  pickup_name: string | null;
  destination_name: string | null;
  vehicle_name: string | null;
};

type PaxKey = string; // `${journey_id}_${vehicle_id}`

/* ---------- Booking history view types ---------- */
type ViewHeader = {
  name: string;
  email: string;
  site_admin: boolean;
  operator_admin: boolean;
  operator_id: string | null;
};

type HistoryRow = {
  user_id: string;
  order_id: string;
  order_item_id?: string | null;
  booked_at: string;
  qty: number | null;

  line_total_cents?: number | null;
  total_cents?: number | null;

  route_name: string | null;
  pickup_name: string | null;
  destination_name: string | null;

  departure_date: string | null;
  pickup_time?: string | null;

  transport_type?: string | null;
  vehicle_name?: string | null;
  operator_name?: string | null;

  item_status?: string | null;
  status?: string | null;
};

/* ---------- Small utils ---------- */
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!sb || !pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function toGBP(cents?: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
  }).format(cents / 100);
}

function formatDateTime(ts?: string | null) {
  if (!ts) return { date: "—", time: "—" };
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString(),
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

function t24Badge(ts?: string | null) {
  if (!ts) return "—";
  const dep = new Date(ts).getTime();
  const now = Date.now();
  const diffH = (dep - now) / (1000 * 60 * 60);
  if (diffH <= 24) return "Locked";
  const left = Math.max(0, Math.floor(diffH - 24));
  return `Locks in ${left}h`;
}

function statusLabel(s: AssignRow["status_simple"]) {
  if (s === "confirmed") return "Confirmed (T-24)";
  if (s === "allocated") return "Assigned (T-72)";
  if (s === "complete") return "Complete";
  return s;
}

/* ============================================================
   DEFAULT EXPORT — Router: Crew Dashboard vs Booking History
   ============================================================ */
export default function AccountPage() {
  const [ident, setIdent] = useState<Identity | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!sb) throw new Error("Supabase not configured");
        setLoading(true);
        setErr(null);

        // Ensure session
        const { data: sRes } = await sb.auth.getSession();
        const user = sRes?.session?.user;
        if (!user) {
          setIdent({ isCrew: false, staffId: null, operatorId: null, roleLabel: null });
          return;
        }

        // NEW: opportunistically auto-link operator_staff.user_id by email.
        // This is idempotent; if already linked, it does nothing.
        try {
          await fetch("/api/crew/auto-link", { method: "POST", credentials: "include" });
        } catch {
          // ignore network errors here; we still try to resolve identity below
        }

        // Try RPC first
        let resolved: Identity | null = null;
        try {
          const { data, error } = await sb.rpc("get_current_identity");
          if (error) throw error;
          const row = Array.isArray(data) ? data[0] : data;
          resolved = {
            isCrew: !!row?.is_crew,
            staffId: row?.staff_id ?? null,
            operatorId: row?.operator_id ?? null,
            roleLabel: row?.role ?? null,
          };
        } catch {
          // RPC not present or errored — fall back to lightweight detection.
          // a) by user_id
          const { data: staffByUser } = await sb
            .from("operator_staff")
            .select("id, role_id, jobrole, operator_id")
            .eq("user_id", user.id)
            .eq("active", true)
            .limit(1)
            .maybeSingle();

          // b) by email (case-insensitive) if not linked yet
          let staff = staffByUser;
          if (!staff && user.email) {
            const { data: byEmail } = await sb
              .from("operator_staff")
              .select("id, role_id, jobrole, operator_id")
              .ilike("email", user.email)
              .eq("active", true)
              .limit(1)
              .maybeSingle();
            staff = byEmail ?? null;
          }

          let roleLabel: string | null = null;
          if (staff?.role_id) {
            const { data: r } = await sb
              .from("transport_type_roles")
              .select("role")
              .eq("id", staff.role_id as UUID)
              .maybeSingle();
            roleLabel = r?.role ?? staff?.jobrole ?? null;
          } else if (staff?.jobrole) {
            roleLabel = staff.jobrole;
          }

          resolved = {
            isCrew: !!staff,
            staffId: staff?.id ?? null,
            operatorId: (staff as any)?.operator_id ?? null,
            roleLabel: roleLabel,
          };
        }

        setIdent(resolved!);
      } catch (e: any) {
        setErr(e?.message ?? "Failed to load identity");
        setIdent({ isCrew: false, staffId: null, operatorId: null, roleLabel: null });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6 text-red-600">{err}</div>;

  const showCrew = crewOpsEnabled() && !!ident?.isCrew;
  return showCrew ? <CrewDashboard /> : <BookingHistory />;
}

/* ============================================================
   Crew Dashboard
   ============================================================ */
function CrewDashboard() {
  const [rows, setRows] = useState(/** @type {AssignRow[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [profile, setProfile] = useState<{
    first: string;
    last: string;
    role: string;
    photo: string;
  } | null>(null);

  const [paxByKey, setPaxByKey] = useState<Record<PaxKey, number>>({});

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        if (!sb) throw new Error("Supabase not configured");
        const { data: { user } } = await sb.auth.getUser();
        if (!user) {
          setErr("Please sign in.");
          setLoading(false);
          return;
        }

        const { data, error } = await sb
          .from("v_crew_assignments_min")
          .select("*")
          .eq("staff_user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;

        const assignments = (data as AssignRow[]) ?? [];
        setRows(assignments);

        // Header profile from view, fall back to operator_staff (+role lookup)
        let f = assignments[0]?.first_name ?? null;
        let l = assignments[0]?.last_name ?? null;
        let role = assignments[0]?.role_label ?? null;
        let photoUrl = assignments[0]?.photo_url ?? null;

        if (!f || !l || !role || !photoUrl) {
          const { data: srow } = await sb
            .from("operator_staff")
            .select("first_name,last_name,photo_url,role_id,jobrole")
            .eq("user_id", user.id)
            .eq("active", true)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (srow) {
            f = f || (srow as any).first_name;
            l = l || (srow as any).last_name;
            photoUrl = photoUrl || (srow as any).photo_url;
            if (!role) {
              if ((srow as any).role_id) {
                const { data: r } = await sb
                  .from("transport_type_roles")
                  .select("role")
                  .eq("id", (srow as any).role_id)
                  .limit(1)
                  .maybeSingle();
                role = r?.role || (srow as any).jobrole || null;
              } else {
                role = (srow as any).jobrole || null;
              }
            }
          }
        }

        const photoResolved = await resolveStorageUrl(photoUrl || null);
        setProfile({
          first: f?.trim() || "Crew",
          last: l?.trim() || "Member",
          role: role ? role.charAt(0).toUpperCase() + role.slice(1) : "Crew",
          photo: photoResolved || "https://via.placeholder.com/80?text=Crew",
        });

        // Pax totals (limited to these journeys/vehicles)
        if (assignments.length) {
          const jIds = Array.from(new Set(assignments.map((r) => r.journey_id)));
          const vIds = Array.from(new Set(assignments.map((r) => r.vehicle_id)));

          const { data: paxRows, error: paxErr } = await sb
            .from("journey_vehicle_allocations")
            .select("journey_id, vehicle_id, seats")
            .in("journey_id", jIds)
            .in("vehicle_id", vIds);
          if (paxErr) throw paxErr;

          const map: Record<PaxKey, number> = {};
          (paxRows || []).forEach((r) => {
            const k = `${r.journey_id}_${r.vehicle_id}`;
            map[k] = (map[k] || 0) + Number(r.seats || 0);
          });
          setPaxByKey(map);
        } else {
          setPaxByKey({});
        }
      } catch (e: any) {
        setErr(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const upcoming = useMemo(
    () => rows.filter((r) => r.status_simple === "allocated" || r.status_simple === "confirmed"),
    [rows]
  );
  const history = useMemo(
    () => rows.filter((r) => r.status_simple === "complete"),
    [rows]
  );

  async function act(kind: "confirm" | "decline", assignmentId: UUID) {
    const res = await fetch(`/api/crew/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      alert(txt || "Action failed");
      return;
    }
    location.reload();
  }

  if (loading) return <div className="p-6">Loading…</div>;
  if (err) return <div className="p-6" style={{ color: "#dc2626" }}>{err}</div>;

  const displayName = profile ? `${profile.first} ${profile.last}`.trim() : "Crew Member";
  const role = profile?.role ?? "Crew";
  const avatar = profile?.photo ?? "https://via.placeholder.com/80?text=Crew";

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <img src={avatar} alt="Crew photo" className="w-16 h-16 rounded-full object-cover border" />
        <div>
          <div className="text-xl font-semibold">{displayName}</div>
          <div className="text-sm opacity-70">{role}</div>
        </div>
      </div>

      {/* Upcoming */}
      <section>
        <h2 className="text-xl font-medium mb-2">Upcoming</h2>
        <div className="rounded border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50">
              <tr>
                <th className="text-left p-3">Pick up</th>
                <th className="text-left p-3">Destination</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Time</th>
                <th className="text-left p-3">Vehicle</th>
                <th className="text-left p-3">Passengers</th>
                <th className="text-left p-3">Lock</th>
                <th className="text-left p-3">Assignment</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr>
                  <td className="p-4" colSpan={9}>
                    No upcoming assignments.
                  </td>
                </tr>
              )}
              {upcoming.map((r) => {
                const { date, time } = formatDateTime(r.departure_ts);
                const k = `${r.journey_id}_${r.vehicle_id}`;
                const pax = Number.isFinite(paxByKey[k]) ? paxByKey[k] : "—";
                return (
                  <tr key={r.assignment_id} className="border-t">
                    <td className="p-3">{r.pickup_name ?? "—"}</td>
                    <td className="p-3">{r.destination_name ?? "—"}</td>
                    <td className="p-3">{date}</td>
                    <td className="p-3">{time}</td>
                    <td className="p-3">
                      {r.vehicle_name ?? `#${r.vehicle_id.slice(0, 8)}`}
                    </td>
                    <td className="p-3">{pax}</td>
                    <td className="p-3">{t24Badge(r.departure_ts)}</td>
                    <td className="p-3">{statusLabel(r.status_simple)}</td>
                    <td className="p-3 text-right">
                      <div className="flex gap-2 justify-end">
                        {r.status_simple !== "confirmed" ? (
                          <>
                            <button
                              onClick={() => act("confirm", r.assignment_id)}
                              className="px-3 py-1 rounded"
                              style={{ background: "black", color: "white" }}
                            >
                              Accept
                            </button>
                            <button
                              onClick={() => act("decline", r.assignment_id)}
                              className="px-3 py-1 rounded border"
                            >
                              Decline
                            </button>
                          </>
                        ) : (
                          <a
                            href={`/crew/manifest/${r.assignment_id}`}
                            className="px-3 py-1 rounded border"
                            title="View manifest"
                          >
                            Manifest
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* History */}
      <section>
        <h2 className="text-xl font-medium mb-2">History</h2>
        <div className="border rounded divide-y">
          {history.length === 0 && (
            <div className="p-4 text-sm">No completed journeys yet.</div>
          )}
          {history.map((r) => (
            <div
              key={r.assignment_id}
              className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-center"
            >
              <div className="md:col-span-3">
                <div className="font-medium">
                  {r.pickup_name ?? "—"} → {r.destination_name ?? "—"}
                </div>
                <div className="text-xs opacity-70">
                  {r.departure_ts ? new Date(r.departure_ts).toLocaleString() : "—"} •{" "}
                  {r.vehicle_name ?? `vehicle #${r.vehicle_id.slice(0, 8)}`}
                </div>
              </div>
              <div>
                <span className="text-xs px-2 py-1 rounded bg-gray-100">complete</span>
              </div>
              <div className="text-xs opacity-70">Tips/Ratings: —</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/* ============================================================
   Booking History (for non-crew users)
   ============================================================ */
function BookingHistory() {
  const [header, setHeader] = useState<ViewHeader>({
    name: "",
    email: "",
    site_admin: false,
    operator_admin: false,
    operator_id: null,
  });

  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyMsg, setHistoryMsg] = useState<string | null>(null);

  // simple paging
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const paged = useMemo(() => {
    const start = (page - 1) * pageSize;
    return history.slice(start, start + pageSize);
  }, [page, history]);

  // Header + history load
  useEffect(() => {
    let off = false;
    (async () => {
      try {
        if (!sb) throw new Error("Supabase not configured");
        const { data: sRes } = await sb.auth.getSession();
        const user = sRes?.session?.user;

        if (user) {
          // header
          const { data: row } = await sb
            .from("users")
            .select("first_name, site_admin, operator_admin, operator_id")
            .eq("id", user.id)
            .maybeSingle();

          const firstName =
            row?.first_name ??
            (user.user_metadata?.first_name as string | undefined) ??
            (user.user_metadata?.given_name as string | undefined) ??
            (user.email ? user.email.split("@")[0] : "") ??
            "";

          if (!off)
            setHeader({
              name: firstName,
              email: user.email ?? "",
              site_admin: !!(row?.site_admin ?? user.user_metadata?.site_admin),
              operator_admin: !!(row?.operator_admin ?? user.user_metadata?.operator_admin),
              operator_id: row?.operator_id ?? null,
            });

          // history
          const { data, error } = await sb
            .from("v_order_history")
            .select("*")
            .eq("user_id", user.id)
            .order("booked_at", { ascending: false });

          if (error) throw error;
          if (!off) setHistory((data as HistoryRow[]) || []);
        } else {
          if (!off) {
            setHistory([]);
          }
        }
      } catch (e: any) {
        if (!off) setHistoryMsg(e?.message || "Failed to load history.");
      } finally {
        if (!off) setLoadingHistory(false);
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  async function refreshHeaderCache() {
    if (!sb) return;
    const { data: sRes } = await sb.auth.getSession();
    const user = sRes?.session?.user;

    if (!user) {
      localStorage.removeItem("ps_user");
      localStorage.setItem("ps_user_v", String(Date.now()));
      return;
    }

    const { data: row } = await sb
      .from("users")
      .select("first_name, site_admin, operator_admin, operator_id")
      .eq("id", user.id)
      .maybeSingle();

    const payload = {
      first_name:
        row?.first_name ??
        (user.user_metadata?.first_name as string | undefined) ??
        (user.user_metadata?.given_name as string | undefined) ??
        null,
      site_admin: !!(row?.site_admin ?? user.user_metadata?.site_admin),
      operator_admin: !!(row?.operator_admin ?? user.user_metadata?.operator_admin),
      operator_id: row?.operator_id ?? null,
    };

    localStorage.setItem("ps_user", JSON.stringify(payload));
    localStorage.setItem("ps_user_v", String(Date.now()));
  }

  async function signOut() {
    if (!sb) return;
    try {
      await sb.auth.signOut();
    } finally {
      localStorage.removeItem("ps_user");
      localStorage.setItem("ps_user_v", String(Date.now()));
      ["ps_name", "ps_header", "ps_cache"].forEach((k) => localStorage.removeItem(k));
      window.location.replace("/login");
    }
  }

  function renderJourney(r: HistoryRow) {
    const legs =
      r.pickup_name && r.destination_name ? `${r.pickup_name} → ${r.destination_name}` : "";
    return (
      <>
        <div className="font-medium">{r.route_name || "Journey"}</div>
        {legs ? <div className="text-neutral-600">{legs}</div> : null}
      </>
    );
  }

  function renderAmount(r: HistoryRow) {
    const cents = r.line_total_cents ?? r.total_cents ?? null;
    return toGBP(cents);
  }

  function renderStatus(r: HistoryRow) {
    return r.item_status ?? r.status ?? "—";
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Your account</h1>

      {/* Header */}
      <section className="rounded border p-4">
        <p>
          <strong>Name:</strong> {header.name || "—"}
        </p>
        <p>
          <strong>Email:</strong> {header.email || "—"}
        </p>
        <p>
          <strong>site_admin:</strong> {String(header.site_admin)}
        </p>
        <p>
          <strong>operator_admin:</strong> {String(header.operator_admin)}
        </p>
        <p>
          <strong>operator_id:</strong> {header.operator_id ?? "—"}
        </p>
      </section>

      <div className="flex gap-3">
        <button onClick={refreshHeaderCache} className="rounded px-3 py-2 border">
          Refresh header cache
        </button>
        <button onClick={signOut} className="rounded px-3 py-2 border">
          Sign out
        </button>
      </div>

      {/* Transaction history */}
      <section className="rounded border p-4">
        <h2 className="text-lg font-semibold mb-3">Transaction History</h2>

        {historyMsg && <p className="text-sm text-red-600 mb-2">{historyMsg}</p>}
        {loadingHistory ? (
          <div className="text-sm text-neutral-600">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-sm text-neutral-600">No bookings yet.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="text-left p-3">Booking date</th>
                    <th className="text-left p-3">Journey</th>
                    <th className="text-left p-3">Type</th>
                    <th className="text-left p-3">Date</th>
                    <th className="text-left p-3">Seats</th>
                    <th className="text-left p-3">Amount</th>
                    <th className="text-left p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r, i) => (
                    <tr key={`${r.order_id}-${i}`} className="border-t">
                      <td className="p-3">
                        {new Date(r.booked_at).toLocaleDateString("en-GB")}
                      </td>
                      <td className="p-3">{renderJourney(r)}</td>
                      <td className="p-3">
                        {r.transport_type
                          ? r.transport_type
                              .replace(/_/g, " ")
                              .replace(/\b\w/g, (s) => s.toUpperCase())
                          : "—"}
                      </td>
                      <td className="p-3">
                        {r.departure_date
                          ? new Date(`${r.departure_date}T12:00:00`).toLocaleDateString("en-GB")
                          : "—"}
                      </td>
                      <td className="p-3">{r.qty ?? "—"}</td>
                      <td className="p-3">{renderAmount(r)}</td>
                      <td className="p-3">{renderStatus(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pager */}
            {history.length > pageSize && (
              <div className="flex items-center gap-3 mt-3">
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Prev
                </button>
                <div className="text-sm">
                  Page {page} of {Math.ceil(history.length / pageSize)}
                </div>
                <button
                  className="px-3 py-1 border rounded disabled:opacity-50"
                  onClick={() =>
                    setPage((p) => Math.min(Math.ceil(history.length / pageSize), p + 1))
                  }
                  disabled={page >= Math.ceil(history.length / pageSize)}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
