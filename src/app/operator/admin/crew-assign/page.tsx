"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type UUID = string;

type Journey = { id: UUID; route_id: UUID; departure_ts: string; is_active: boolean };
type Vehicle = { id: UUID; operator_id: UUID; name: string; capacity: number; is_active: boolean };
type RVA = { id: UUID; journey_id: UUID; vehicle_id: UUID; is_active: boolean };

type Crew = { id: UUID; full_name: string; email?: string | null; phone?: string | null; is_active: boolean };
type Assignment = {
  journey_id: UUID;
  vehicle_id: UUID;
  role_code: "CAPTAIN" | "FIRST_MATE" | "STEWARD" | "ENGINEER";
  crew_id: UUID;
  crew_name: string;
  crew_email?: string | null;
  crew_phone?: string | null;
  assigned_at: string;
};

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

const ROLES = ["CAPTAIN", "FIRST_MATE", "STEWARD", "ENGINEER"] as const;

export default function CrewAssignPage() {
  const [journeys, setJourneys] = useState<Journey[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [rvas, setRvas] = useState<RVA[]>([]);
  const [crew, setCrew] = useState<Crew[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [selectedJourney, setSelectedJourney] = useState<UUID | "">("");
  const [selectedVehicle, setSelectedVehicle] = useState<UUID | "">("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;

    (async () => {
      setLoading(true);
      try {
        const [{ data: j }, { data: v }, { data: rv }, { data: cr }] = await Promise.all([
          supabase.from("journeys").select("id, route_id, departure_ts, is_active").order("departure_ts"),
          supabase.from("vehicles").select("id, operator_id, name, capacity, is_active").order("name"),
          supabase.from("journey_vehicle_allocations").select("id, journey_id, vehicle_id, is_active"),
          fetch("/api/crew").then(r => r.json()).then(r => r.data as Crew[])
        ]);

        setJourneys(j ?? []);
        setVehicles(v ?? []);
        setRvas(rv ?? []);
        setCrew(cr ?? []);
      } catch (e: any) {
        setMsg(e?.message ?? "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedJourney || !selectedVehicle) return;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/crew-assignments?journey_id=${selectedJourney}&vehicle_id=${selectedVehicle}`);
        const json = await res.json();
        if (res.ok) setAssignments(json.data ?? []);
        else setMsg(json.error ?? "Failed to load assignments");
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedJourney, selectedVehicle]);

  const eligibleRvas = useMemo(
    () => rvas.filter(r => r.is_active),
    [rvas]
  );

  const current = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const a of assignments) {
      map.set(a.role_code, a);
    }
    return map;
  }, [assignments]);

  async function assign(role_code: Assignment["role_code"], crew_id: UUID) {
    if (!selectedJourney || !selectedVehicle || !crew_id) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/crew-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          journey_id: selectedJourney,
          vehicle_id: selectedVehicle,
          crew_id,
          role_code
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to assign");

      // refresh
      const list = await fetch(`/api/crew-assignments?journey_id=${selectedJourney}&vehicle_id=${selectedVehicle}`).then(r => r.json());
      setAssignments(list.data ?? []);
      setMsg("Saved");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function unassign(role_code: Assignment["role_code"], crew_id: UUID) {
    if (!selectedJourney || !selectedVehicle || !crew_id) return;
    setLoading(true);
    setMsg(null);
    try {
      const url = `/api/crew-assignments?journey_id=${selectedJourney}&vehicle_id=${selectedVehicle}&crew_id=${crew_id}&role_code=${role_code}`;
      const res = await fetch(url, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to unassign");

      const list = await fetch(`/api/crew-assignments?journey_id=${selectedJourney}&vehicle_id=${selectedVehicle}`).then(r => r.json());
      setAssignments(list.data ?? []);
      setMsg("Removed");
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="text-2xl font-semibold mb-4">Crew Assignment</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div>
          <label className="block text-sm font-medium mb-1">Journey</label>
          <select
            value={selectedJourney}
            onChange={(e) => setSelectedJourney(e.target.value as UUID)}
            className="w-full border rounded-lg p-2"
          >
            <option value="">Select journey…</option>
            {journeys.map(j => (
              <option key={j.id} value={j.id}>
                {new Date(j.departure_ts).toLocaleString()} — {j.is_active ? "Active" : "Inactive"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Vehicle</label>
          <select
            value={selectedVehicle}
            onChange={(e) => setSelectedVehicle(e.target.value as UUID)}
            className="w-full border rounded-lg p-2"
          >
            <option value="">Select vehicle…</option>
            {vehicles.filter(v => v.is_active).map(v => (
              <option key={v.id} value={v.id}>{v.name} (cap {v.capacity})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Eligible allocations</label>
          <div className="text-sm border rounded-lg p-2 h-10 overflow-hidden">
            {selectedJourney && selectedVehicle
              ? "Journey & vehicle selected"
              : "Pick a journey and a vehicle"}
          </div>
        </div>
      </div>

      {msg && <div className="mb-4 text-sm text-blue-700">{msg}</div>}

      {selectedJourney && selectedVehicle && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {ROLES.map(role => {
            const a = current.get(role);
            return (
              <div key={role} className="border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold">{role.replace("_"," ")}</h2>
                  {a ? (
                    <button
                      className="text-sm px-3 py-1 rounded-md border"
                      onClick={() => unassign(role, a.crew_id)}
                      disabled={loading}
                    >
                      Unassign
                    </button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="block text-sm">Assign crew</label>
                  <select
                    className="w-full border rounded-lg p-2"
                    onChange={(e) => {
                      const crew_id = e.target.value as UUID;
                      if (crew_id) assign(role, crew_id);
                      e.currentTarget.selectedIndex = 0;
                    }}
                    disabled={loading}
                  >
                    <option value="">Select crew…</option>
                    {crew.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.full_name}{c.email ? ` • ${c.email}` : ""}{c.phone ? ` • ${c.phone}` : ""}
                      </option>
                    ))}
                  </select>

                  {a && (
                    <div className="text-sm text-neutral-700">
                      Assigned: <span className="font-medium">{a.crew_name}</span>{" "}
                      <span className="text-neutral-500">({new Date(a.assigned_at).toLocaleString()})</span><br/>
                      {a.crew_email && <span className="text-neutral-600">{a.crew_email}</span>}{" "}
                      {a.crew_phone && <span className="text-neutral-600">• {a.crew_phone}</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
