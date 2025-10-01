"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase (browser) for READS only ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Country = { id: string; name: string };
type Pickup = { id: string; name: string; country_id: string; picture_url: string | null };
type Destination = { id: string; name: string; country_id: string | null; picture_url: string | null };
type JourneyType = { id: string; name: string };

type Row = {
  id: string;
  route_name: string | null;
  name: string | null;
  country_id: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  approx_duration_mins: number | null;
  approximate_distance_miles: number | null;
  pickup_time: string | null;
  frequency: string | null;
  is_active: boolean | null;

  // linked type + legacy label
  journey_type_id: string | null;
  transport_type: string | null;

  // season
  season_from: string | null;
  season_to: string | null;
};

function toNum(v: string): number | null {
  if (!v?.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function RoutesPage() {
  /* Lookups */
  const [countries, setCountries] = useState<Country[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);

  /* Rows */
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  /* Form */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [countryId, setCountryId] = useState("");
  const [pickupId, setPickupId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [approxDuration, setApproxDuration] = useState("");
  const [approxDistance, setApproxDistance] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [frequency, setFrequency] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Journey type + season
  const [journeyTypeId, setJourneyTypeId] = useState("");
  const [seasonFrom, setSeasonFrom] = useState("");
  const [seasonTo, setSeasonTo] = useState("");

  /* UI */
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* Helpers */
  const countryName = (id: string | null | undefined) =>
    countries.find((c) => c.id === id)?.name ?? "";

  const journeyTypeName = (id: string | null | undefined) =>
    journeyTypes.find((t) => t.id === id)?.name ?? "—";

  const filteredPickups = useMemo(
    () => pickups.filter((p) => !countryId || p.country_id === countryId),
    [pickups, countryId]
  );
  const filteredDestinations = useMemo(
    () => destinations.filter((d) => !countryId || d.country_id === countryId),
    [destinations, countryId]
  );

  const pickup = useMemo(() => pickups.find((p) => p.id === pickupId) || null, [pickups, pickupId]);
  const destination = useMemo(
    () => destinations.find((d) => d.id === destinationId) || null,
    [destinations, destinationId]
  );
  const derivedRouteName = useMemo(() => {
    const a = pickup?.name?.trim();
    const b = destination?.name?.trim();
    return a && b ? `${a} → ${b}` : "";
  }, [pickup?.name, destination?.name]);

  /* Initial load */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [c, pu, de, jt, r] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("pickup_points").select("id,name,country_id,picture_url").order("name"),
        sb.from("destinations").select("id,name,country_id,picture_url").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("routes").select("*").order("created_at", { ascending: false }),
      ]);
      if (off) return;

      if (c.error || pu.error || de.error || jt.error || r.error) {
        console.error("Load errors:", { c: c.error, pu: pu.error, de: de.error, jt: jt.error, r: r.error });
        setMsg(
          c.error?.message ||
            pu.error?.message ||
            de.error?.message ||
            jt.error?.message ||
            r.error?.message ||
            "Load failed"
        );
      }

      setCountries((c.data as Country[]) || []);
      setPickups((pu.data as Pickup[]) || []);
      setDestinations((de.data as Destination[]) || []);
      setJourneyTypes((jt.data as JourneyType[]) || []);
      setRows((r.data as Row[]) || []);
      setLoading(false);
    })();
    return () => {
      off = true;
    };
  }, []);

  async function reloadRows() {
    const { data, error } = await sb.from("routes").select("*").order("created_at", { ascending: false });
    if (error) {
      setMsg(error.message);
      return;
    }
    setRows((data as Row[]) || []);
  }

  function resetForm() {
    setEditingId(null);
    setCountryId("");
    setPickupId("");
    setDestinationId("");
    setApproxDuration("");
    setApproxDistance("");
    setPickupTime("");
    setFrequency("");
    setIsActive(true);
    setJourneyTypeId("");
    setSeasonFrom("");
    setSeasonTo("");
    setMsg(null);
  }

  async function loadOne(id: string) {
    setMsg(null);
    const { data, error } = await sb.from("routes").select("*").eq("id", id).single();
    if (error || !data) {
      setMsg(error?.message ?? "Could not load route.");
      return;
    }
    setEditingId(id);
    setCountryId(data.country_id ?? "");
    setPickupId(data.pickup_id ?? "");
    setDestinationId(data.destination_id ?? "");
    setApproxDuration((data.approx_duration_mins ?? "").toString());
    setApproxDistance((data.approximate_distance_miles ?? "").toString());
    setPickupTime(data.pickup_time ?? "");
    setFrequency(data.frequency ?? "");
    setIsActive(data.is_active ?? true);

    // Journey type + season
    setJourneyTypeId(data.journey_type_id ?? "");
    setSeasonFrom(data.season_from ?? "");
    setSeasonTo(data.season_to ?? "");
    setMsg(`Editing: ${data.route_name || data.name || id}`);
  }

  /* ---------- SAVE via API (prevents 405) ---------- */
  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);

      // must-have fields for both create & update
      if (!countryId || !pickupId || !destinationId) {
        setMsg("Please select Country, Pick-up and Destination.");
        return;
      }

      // Require Journey Type on create only
      if (!editingId && !journeyTypeId) {
        setMsg("Please select a Journey Type.");
        return;
      }

      if (seasonFrom && seasonTo && new Date(seasonFrom) > new Date(seasonTo)) {
        setMsg("Season To must be on or after Season From.");
        return;
      }

      setSaving(true);

      const jtName = journeyTypeName(journeyTypeId);
      const payload = {
        country_id: countryId,
        pickup_id: pickupId,
        destination_id: destinationId,
        approx_duration_mins: toNum(approxDuration),
        approximate_distance_miles: toNum(approxDistance),
        pickup_time: pickupTime || null,
        frequency: frequency || null,
        is_active: isActive,

        // NEW: persist the auto-generated name
        route_name: derivedRouteName || null,

        // Journey type + legacy text kept in sync
        journey_type_id: journeyTypeId || null,
        transport_type: jtName === "—" ? null : jtName,

        // Season window
        season_from: seasonFrom || null,
        season_to: seasonTo || null,
      };

      const res = await fetch(editingId ? `/api/admin/routes/${editingId}` : `/api/admin/routes`, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaving(false);
        setMsg(body?.error || `Save failed (${res.status})`);
        return;
      }

      setMsg(editingId ? "Updated ✅" : "Created ✅");
      await reloadRows();
      if (!editingId) resetForm();
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove(row: Row) {
    if (!confirm(`Delete route "${row.route_name || row.name || "this route"}"?`)) return;
    setMsg(null);
    setDeletingId(row.id);
    const res = await fetch(`/api/admin/routes/${row.id}`, { method: "DELETE", headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setDeletingId(null);
      setMsg(body?.error || `Delete failed (${res.status})`);
      return;
    }
    if (editingId === row.id) resetForm();
    await reloadRows();
    setDeletingId(null);
    setMsg("Deleted.");
  }

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) =>
      (r.route_name || r.name || "").toLowerCase().includes(s) ||
      countryName(r.country_id).toLowerCase().includes(s)
    );
  }, [rows, q, countries]);

  const nameFor = (id: string | null | undefined, list: { id: string; name: string }[]) =>
    (id && list.find((x) => x.id === id)?.name) || "—";
  const thumbPickup = (id: string | null | undefined) =>
    (id && pickups.find((p) => p.id === id)?.picture_url) || null;
  const thumbDest = (id: string | null | undefined) =>
    (id && destinations.find((d) => d.id === id)?.picture_url) || null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Routes</h1>
        <p className="text-neutral-600">Create, edit and delete routes connecting pick-up points to destinations.</p>
      </header>

      {/* Form */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          {/* Country / Pickup / Destination */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Country *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={countryId} onChange={(e) => {
                setCountryId(e.target.value);
                setPickupId("");
                setDestinationId("");
              }}>
                <option value="">— Select —</option>
                {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Pick-up Point *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={pickupId} onChange={(e) => setPickupId(e.target.value)} disabled={!countryId}>
                <option value="">— Select —</option>
                {filteredPickups.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {pickup?.picture_url && (
                <img src={pickup.picture_url} alt={pickup.name} className="mt-2 h-24 w-40 object-cover rounded border" />
              )}
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">Destination *</label>
              <select className="w-full border rounded-lg px-3 py-2" value={destinationId} onChange={(e) => setDestinationId(e.target.value)} disabled={!countryId}>
                <option value="">— Select —</option>
                {filteredDestinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              {destination?.picture_url && (
                <img src={destination.picture_url} alt={destination.name} className="mt-2 h-24 w-40 object-cover rounded border" />
              )}
            </div>
          </div>

          {/* Derived route name + metrics */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Route Name</label>
              <input className="w-full border rounded-lg px-3 py-2 bg-neutral-50" value={derivedRouteName} readOnly placeholder="Will auto-fill from selections" />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Approximate Duration (mins)</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="numeric" value={approxDuration} onChange={(e) => setApproxDuration(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Approximate Distance (miles)</label>
              <input className="w-full border rounded-lg px-3 py-2" inputMode="decimal" value={approxDistance} onChange={(e) => setApproxDistance(e.target.value)} />
            </div>
          </div>

          {/* Journey Type + Season From/To */}
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Journey Type{editingId ? "" : " *"}</label>
              <select className="w-full border rounded-lg px-3 py-2" value={journeyTypeId} onChange={(e) => setJourneyTypeId(e.target.value)}>
                <option value="">— Select —</option>
                {journeyTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Season From</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2" value={seasonFrom} onChange={(e) => setSeasonFrom(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Season To</label>
              <input type="date" className="w-full border rounded-lg px-3 py-2" value={seasonTo} onChange={(e) => setSeasonTo(e.target.value)} />
              {seasonFrom && seasonTo && new Date(seasonFrom) > new Date(seasonTo) && (
                <p className="text-xs text-red-600 mt-1">Season To must be on or after Season From.</p>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Pick-up Time (local)</label>
              <input type="time" className="w-full border rounded-lg px-3 py-2" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Frequency (plain text)</label>
              <input className="w-full border rounded-lg px-3 py-2" placeholder="e.g., Every Tuesday" value={frequency} onChange={(e) => setFrequency(e.target.value)} />
            </div>
            <div className="flex items-end">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={
                saving ||
                !countryId ||
                !pickupId ||
                !destinationId ||
                (!editingId && !journeyTypeId) // Journey Type required only on create
              }
              className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update Route" : "Create Route"}
            </button>
            {editingId && (
              <button
                type="button"
                className="inline-flex rounded-full px-4 py-2 border text-sm"
                onClick={resetForm}
                disabled={saving}
              >
                Cancel
              </button>
            )}
            {msg && <span className="text-sm text-neutral-600">{msg}</span>}
          </div>
        </form>
      </section>

      {/* List */}
      <section className="space-y-3">
        <div className="flex gap-2">
          <input
            className="border rounded-lg px-3 py-2"
            placeholder="Search routes…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow">
          {loading ? (
            <div className="p-4">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-4">No routes yet.</div>
          ) : (
            <table className="w-full">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Route</th>
                  <th className="text-left p-3">Country</th>
                  <th className="text-left p-3">Pick-up</th>
                  <th className="text-left p-3">Destination</th>
                  <th className="text-left p-3">Journey Type</th>
                  <th className="text-left p-3">Frequency</th>{/* ← added */}
                  <th className="text-left p-3">Duration (mins)</th>
                  <th className="text-left p-3">Distance (mi)</th>
                  <th className="text-left p-3">Active</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="p-3">
                      <button
                        className="px-2 py-1 rounded-full border"
                        onClick={() => loadOne(r.id)}
                        title="Edit"
                      >
                        {r.route_name || r.name || "—"}
                      </button>
                    </td>
                    <td className="p-3">{countryName(r.country_id)}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {thumbPickup(r.pickup_id) ? (
                          <img
                            src={thumbPickup(r.pickup_id)!}
                            className="h-10 w-16 object-cover rounded border"
                            alt="pickup"
                          />
                        ) : (
                          <div className="h-10 w-16 rounded border bg-neutral-100" />
                        )}
                        <span>{nameFor(r.pickup_id, pickups)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        {thumbDest(r.destination_id) ? (
                          <img
                            src={thumbDest(r.destination_id)!}
                            className="h-10 w-16 object-cover rounded border"
                            alt="destination"
                          />
                        ) : (
                          <div className="h-10 w-16 rounded border bg-neutral-100" />
                        )}
                        <span>{nameFor(r.destination_id, destinations)}</span>
                      </div>
                    </td>
                    <td className="p-3">
                      {journeyTypeName(r.journey_type_id) !== "—"
                        ? journeyTypeName(r.journey_type_id)
                        : (r.transport_type ?? "—")}
                    </td>
                    <td className="p-3">{r.frequency || "—"}</td>{/* ← added */}
                    <td className="p-3">{r.approx_duration_mins ?? "—"}</td>
                    <td className="p-3">{r.approximate_distance_miles ?? "—"}</td>
                    <td className="p-3">{(r.is_active ?? true) ? "Yes" : "No"}</td>
                    <td className="p-3 text-right space-x-2">
                      <button className="px-3 py-1 rounded-full border" onClick={() => loadOne(r.id)}>Edit</button>
                      <button
                        className="px-3 py-1 rounded-full border"
                        onClick={() => onRemove(r)}
                        disabled={deletingId === r.id}
                      >
                        {deletingId === r.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
