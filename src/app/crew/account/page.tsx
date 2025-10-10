"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function enabled() {
  return String(process.env.NEXT_PUBLIC_CREW_OPS_ENABLED).toLowerCase() === "true";
}

type AssignRow = {
  assignment_id: string;
  journey_id: string;
  vehicle_id: string;
  staff_id: string;
  staff_user_id: string;
  role_id: string | null;
  status_simple: "allocated" | "confirmed" | "complete";
  assigned_at: string | null;
  confirmed_at: string | null;
  created_at: string;
  // identity/timing from view
  first_name: string | null;
  last_name: string | null;
  photo_url: string | null;
  role_label: string | null;
  departure_ts: string | null;
  // NEW labels from view
  pickup_name: string | null;
  destination_name: string | null;
  vehicle_name: string | null;
};

// Near top: new type
type PaxKey = string; // `${journey_id}_${vehicle_id}`

// After you set rows (inside the big useEffect once rows are known), fetch pax totals:
const [paxByKey, setPaxByKey] = useState<Record<PaxKey, number>>({});

useEffect(() => {
  (async () => {
    if (!rows.length) { setPaxByKey({}); return; }
    const keys = rows.map(r => ({ journey_id: r.journey_id, vehicle_id: r.vehicle_id }));
    // dedupe keys
    const uniq = Array.from(new Set(keys.map(k => `${k.journey_id}_${k.vehicle_id}`)))
      .map(k => ({ journey_id: k.split("_")[0], vehicle_id: k.split("_")[1] }));

    const { data, error } = await sb
      .from("journey_vehicle_allocations")
      .select("journey_id, vehicle_id, seats");
    if (error) { console.warn(error.message); return; }

    const map: Record<PaxKey, number> = {};
    (data || []).forEach(r => {
      const k = `${r.journey_id}_${r.vehicle_id}`;
      map[k] = (map[k] || 0) + Number(r.seats || 0);
    });
    setPaxByKey(map);
  })();
}, [rows]);




const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);
async function resolveStorageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage.from("images").createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function CrewAccountPage() {
  const [flag, setFlag] = useState(false);
  const [rows, setRows] = useState<AssignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [profile, setProfile] = useState<{ first: string; last: string; role: string; photo: string } | null>(null);

  useEffect(() => { setFlag(enabled()); }, []);

  useEffect(() => {
    if (!flag) return;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data: { user }, error: uerr } = await sb.auth.getUser();
        if (uerr || !user) { setErr("Please sign in."); setLoading(false); return; }

        const { data, error } = await sb
          .from("v_crew_assignments_min")
          .select("*")
          .eq("staff_user_id", user.id)
          .order("created_at", { ascending: false });
        if (error) throw error;

        const assignments = (data as AssignRow[]) ?? [];
        setRows(assignments);

        // header profile (from first row; if none, look up operator_staff)
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
          last : l?.trim() || "Member",
          role : role ? role.charAt(0).toUpperCase() + role.slice(1) : "Crew",
          photo: photoResolved || "https://via.placeholder.com/80?text=Crew",
        });
      } catch (e: any) {
        setErr(e.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [flag]);

  const upcoming = useMemo(
    () => rows.filter(r => r.status_simple === "allocated" || r.status_simple === "confirmed"),
    [rows]
  );
  const history = useMemo(
    () => rows.filter(r => r.status_simple === "complete"),
    [rows]
  );

function t24Badge(ts?: string | null) {
  if (!ts) return "—";
  const dep = new Date(ts).getTime();
  const now = Date.now();
  const diffH = (dep - now) / (1000 * 60 * 60);
  if (diffH <= 24) return "Locked";
  const left = Math.floor(diffH - 24);
  return `Locks in ${left}h`;
}


  function formatDateTime(ts?: string | null) {
    if (!ts) return { date: "—", time: "—" };
    const d = new Date(ts);
    return {
      date: d.toLocaleDateString(),
      time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };
  }

  function tLabel(s: AssignRow["status_simple"]) {
    if (s === "confirmed") return "Confirmed (T-24)";
    if (s === "allocated") return "Assigned (T-72)";
    if (s === "complete")  return "Complete";
    return s;
  }

  async function act(kind: "confirm" | "decline", assignmentId: string) {
    const res = await fetch(`/api/crew/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignmentId }),
    });
    if (!res.ok) { alert(await res.text()); return; }
    location.reload();
  }

  if (!flag) return <div className="p-6">Crew Ops are coming soon.</div>;
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
                <th className="text-left p-3">Vehicle type</th>
                <th className="text-left p-3">Vehicle name</th>
                <th className="text-left p-3">No. of Passengers</th>
                <th className="text-left p-3">Status</th>
                <th className="text-right p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {upcoming.length === 0 && (
                <tr><td className="p-4" colSpan={9}>No upcoming assignments.</td></tr>
              )}
              {upcoming.map((r) => {
                const { date, time } = formatDateTime(r.departure_ts);
                return (
                  <tr key={r.assignment_id} className="border-t">
                    <td className="p-3">{r.pickup_name ?? "—"}</td>
                    <td className="p-3">{r.destination_name ?? "—"}</td>
                    <td className="p-3">{date}</td>
                    <td className="p-3">{time}</td>
                    <td className="p-3">
  {(() => {
    const k = `${r.journey_id}_${r.vehicle_id}`;
    const n = paxByKey[k];
    return Number.isFinite(n) ? n : "—";
  })()}
</td>
                    <td className="p-3">{r.vehicle_name ?? `#${r.vehicle_id.slice(0, 8)}`}</td>
                    <td className="p-3">{t24Badge(r.departure_ts)}</td>
                    <td className="p-3">{tLabel(r.status_simple)}</td>
                    <td className="p-3 text-right">
                      <div className="flex gap-2 justify-end">
                        {r.status_simple !== "confirmed" && (
                          <>
                            <button onClick={() => act("confirm", r.assignment_id)} className="px-3 py-1 rounded" style={{ background: "black", color: "white" }}>
                              Accept
                            </button>
                            <button onClick={() => act("decline", r.assignment_id)} className="px-3 py-1 rounded border">
                              Decline
                            </button>
                          </>
                        )}
                        {r.status_simple === "confirmed" && (
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

      {/* History (unchanged) */}
      <section>
        <h2 className="text-xl font-medium mb-2">History</h2>
        <div className="border rounded divide-y">
          {history.length === 0 && <div className="p-4 text-sm">No completed journeys yet.</div>}
          {history.map((r) => (
            <div key={r.assignment_id} className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-center">
              <div className="md:col-span-3">
                <div className="font-medium">Journey #{r.journey_id.slice(0, 8)}</div>
                <div className="text-xs opacity-70">
                  {r.departure_ts ? new Date(r.departure_ts).toLocaleString() : "—"} • vehicle #{r.vehicle_id.slice(0, 8)}
                </div>
              </div>
              <div><span className="text-xs px-2 py-1 rounded bg-gray-100">complete</span></div>
              <div className="text-xs opacity-70">Tips/Ratings: —</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
