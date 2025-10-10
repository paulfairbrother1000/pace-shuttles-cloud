// src/app/operator-admin/routes/components/CaptainPicker.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { assignLead } from "@/lib/opsAssign";

type Candidate = {
  staff_id: string;
  name: string;
  jobrole: string | null;
  photo_url: string | null;
  fairuse_score: number;
  fairuse_level: "low" | "medium" | "high";
  is_captain_role: boolean;
};

function levelClasses(level: Candidate["fairuse_level"]) {
  switch (level) {
    case "low":
      return "bg-emerald-100 text-emerald-800 border-emerald-300";
    case "medium":
      return "bg-amber-100 text-amber-800 border-amber-300";
    default:
      return "bg-rose-100 text-rose-800 border-rose-300";
  }
}

export default function CaptainPicker({
  operatorId,
  journeyId,
  vehicleId,
  departureTs,
  onAssigned,
}: {
  operatorId: string;
  journeyId: string;
  vehicleId: string;
  departureTs: string; // ISO
  onAssigned?: (assignmentId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({
          operator_id: operatorId,
          departure_ts: departureTs,
        }).toString();
        const res = await fetch(`/api/ops/captain-candidates?${qs}`);
        if (!res.ok) throw new Error(`Fetch candidates failed (${res.status})`);
        const body = await res.json();
        if (!off) setCands(body.candidates as Candidate[]);
      } catch (e: any) {
        if (!off) setErr(e?.message ?? String(e));
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [operatorId, departureTs]);

  const captainFirst = useMemo(
    () => [...cands.filter(c => c.is_captain_role), ...cands.filter(c => !c.is_captain_role)],
    [cands]
  );

  async function pick(staffId?: string) {
    setErr(null);
    try {
      const id = await assignLead(journeyId, vehicleId, staffId);
      onAssigned?.(id);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Assign Captain</h3>
        <button
          onClick={() => pick(undefined)}
          className="rounded-full border px-3 py-1.5 text-sm"
          title="Auto-pick (fair-use)"
        >
          Auto-pick
        </button>
      </div>

      {err && <div className="text-sm text-rose-600">{err}</div>}
      {loading && <div className="text-sm text-neutral-500">Loading candidates…</div>}

      <ul className="divide-y rounded-xl border bg-white">
        {captainFirst.map((c) => (
          <li key={c.staff_id} className="p-3 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full overflow-hidden bg-neutral-200 flex-shrink-0">
              {c.photo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.photo_url} alt={c.name} className="h-full w-full object-cover" />
              ) : (
                <div className="h-full w-full grid place-items-center text-xs text-neutral-600">
                  {c.name.slice(0, 2).toUpperCase()}
                </div>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{c.name}</span>
                <span
                  className={`inline-flex items-center gap-1 text-xs border rounded-full px-2 py-0.5 ${levelClasses(
                    c.fairuse_level
                  )}`}
                  title={`Fair-use score ${c.fairuse_score}`}
                >
                  Fair-use: {c.fairuse_level}
                </span>
              </div>
              <div className="text-xs text-neutral-500">{c.jobrole || "—"}</div>
            </div>

            <button
              onClick={() => pick(c.staff_id)}
              className="rounded-full px-3 py-1.5 border text-sm"
            >
              Assign
            </button>
          </li>
        ))}

        {!loading && captainFirst.length === 0 && (
          <li className="p-3 text-sm text-neutral-500">No active staff found.</li>
        )}
      </ul>
    </div>
  );
}
