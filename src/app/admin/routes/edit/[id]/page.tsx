"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { createBrowserClient } from "@supabase/ssr";

/* ---------- Supabase ---------- */
const sb = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/* ---------- Types ---------- */
type Country = { id: string; name: string };
type Pickup = { id: string; name: string; country_id: string; picture_url: string | null };
type Destination = { id: string; name: string; country_id: string | null; picture_url: string | null };
type JourneyType = { id: string; name: string };
type RouteRow = {
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
  journey_type_id: string | null;
  transport_type: string | null;
  season_from: string | null;
  season_to: string | null;
};

const placeholder = "/placeholder.png";

/* Public image helper (same as index/home) */
function publicImage(input?: string | null): string | undefined {
  const raw = (input || "").trim();
  if (!raw) return undefined;

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const supaHost = supaUrl.replace(/^https?:\/\//i, "");
  const bucket = (process.env.NEXT_PUBLIC_PUBLIC_BUCKET || "images").replace(/^\/+|\/+$/g, "");
  if (!supaHost) return undefined;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname);
      const m = u.pathname.match(/\/storage\/v1\/object\/public\/(.+)$/);
      if (m) {
        return (isLocal || u.hostname !== supaHost)
          ? `https://${supaHost}/storage/v1/object/public/${m[1]}?v=5`
          : `${raw}?v=5`;
      }
      return raw;
    } catch { /* ignore */ }
  }
  if (raw.startsWith("/storage/v1/object/public/")) {
    return `https://${supaHost}${raw}?v=5`;
  }
  const key = raw.replace(/^\/+/, "");
  if (key.startsWith(`${bucket}/`)) {
    return `https://${supaHost}/storage/v1/object/public/${key}?v=5`;
  }
  return `https://${supaHost}/storage/v1/object/public/${bucket}/${key}?v=5`;
}

/* Collage */
function Collage({ left, right, alt }: { left?: string | null; right?: string | null; alt?: string }) {
  const l = publicImage(left) || placeholder;
  const r = publicImage(right) || placeholder;
  return (
    <div className="relative overflow-hidden rounded-xl shadow-sm">
      <div className="grid grid-cols-2 h-28 w-full">
        <img src={l} alt={alt || "Pick-up"} className="h-full w-full object-cover" />
        <img src={r} alt={alt || "Destination"} className="h-full w-full object-cover" />
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[1px] bg-white/70 mix-blend-overlay" />
    </div>
  );
}

/* Tile grid for mobile pickers */
function TileGrid<T extends { id: string; name: string; picture_url?: string | null }>({
  title,
  items,
  selectedId,
  onSelect,
  emptyHint,
}: {
  title: string;
  items: T[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  emptyHint?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm text-neutral-600">{title}</div>
      {items.length === 0 ? (
        <div className="rounded-xl border p-4 text-sm text-neutral-600 bg-white">
          {emptyHint || "Nothing to show yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {items.map(it => {
            const active = selectedId === it.id;
            const img = publicImage(it.picture_url) || placeholder;
            return (
              <button
                key={it.id}
                onClick={() => onSelect(it.id)}
                className={`text-left rounded-2xl border bg-white overflow-hidden transition shadow-sm ${
                  active ? "ring-2 ring-blue-600 border-blue-600" : "hover:shadow"
                }`}
              >
                <div className="aspect-[16/9] w-full overflow-hidden">
                  <img src={img} alt={it.name} className="h-full w-full object-cover" />
                </div>
                <div className="p-3">
                  <div className="font-medium">{it.name}</div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function toNum(v: string): number | null {
  if (!v?.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function RouteEditPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNew = !params?.id || params.id === "new";

  /* Lookups */
  const [countries, setCountries] = useState<Country[]>([]);
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);

  /* Form state */
  const [editingId, setEditingId] = useState<string | null>(isNew ? null : params.id);
  const [countryId, setCountryId] = useState("");
  const [pickupId, setPickupId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [approxDuration, setApproxDuration] = useState("");
  const [approxDistance, setApproxDistance] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [frequency, setFrequency] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [journeyTypeId, setJourneyTypeId] = useState("");
  const [seasonFrom, setSeasonFrom] = useState("");
  const [seasonTo, setSeasonTo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  /* Derived */
  const pickup = useMemo(() => pickups.find(p => p.id === pickupId) || null, [pickups, pickupId]);
  const destination = useMemo(() => destinations.find(d => d.id === destinationId) || null, [destinations, destinationId]);
  const routeName = useMemo(() => {
    const a = pickup?.name?.trim();
    const b = destination?.name?.trim();
    return a && b ? `${a} → ${b}` : "";
  }, [pickup?.name, destination?.name]);

  const filteredPickups = useMemo(
    () => pickups.filter(p => !countryId || p.country_id === countryId),
    [pickups, countryId]
  );
  const filteredDestinations = useMemo(
    () => destinations.filter(d => !countryId || d.country_id === countryId),
    [destinations, countryId]
  );

  /* Load lookups + record */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);
      const [c, p, d, t] = await Promise.all([
        sb.from("countries").select("id,name").order("name"),
        sb.from("pickup_points").select("id,name,country_id,picture_url").order("name"),
        sb.from("destinations").select("id,name,country_id,picture_url").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
      ]);
      if (off) return;
      setCountries((c.data as Country[]) || []);
      setPickups((p.data as Pickup[]) || []);
      setDestinations((d.data as Destination[]) || []);
      setJourneyTypes((t.data as JourneyType[]) || []);

      if (!isNew) {
        const one = await sb.from("routes").select("*").eq("id", params.id).single();
        if (one.error || !one.data) {
          setMsg(one.error?.message ?? "Could not load route.");
        } else {
          const r = one.data as RouteRow;
          setEditingId(r.id);
          setCountryId(r.country_id ?? "");
          setPickupId(r.pickup_id ?? "");
          setDestinationId(r.destination_id ?? "");
          setApproxDuration((r.approx_duration_mins ?? "").toString());
          setApproxDistance((r.approximate_distance_miles ?? "").toString());
          setPickupTime(r.pickup_time ?? "");
          setFrequency(r.frequency ?? "");
          setIsActive(r.is_active ?? true);
          setJourneyTypeId(r.journey_type_id ?? "");
          setSeasonFrom(r.season_from ?? "");
          setSeasonTo(r.season_to ?? "");
        }
      }
      setLoading(false);
    })();
    return () => { off = true; };
  }, [isNew, params?.id]);

  const jtName = (id: string | null | undefined) =>
    journeyTypes.find(t => t.id === id)?.name ?? "—";

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      setMsg(null);

      if (!countryId || !pickupId || !destinationId) {
        setMsg("Please select Country, Pick-up and Destination.");
        return;
      }
      if (!editingId && !journeyTypeId) {
        setMsg("Please select a Journey Type.");
        return;
      }
      if (seasonFrom && seasonTo && new Date(seasonFrom) > new Date(seasonTo)) {
        setMsg("Season To must be on or after Season From.");
        return;
      }

      setSaving(true);

      const payload = {
        country_id: countryId,
        pickup_id: pickupId,
        destination_id: destinationId,
        approx_duration_mins: toNum(approxDuration),
        approximate_distance_miles: toNum(approxDistance),
        pickup_time: pickupTime || null,
        frequency: frequency || null,
        is_active: isActive,
        route_name: routeName || null,
        journey_type_id: journeyTypeId || null,
        transport_type: jtName(journeyTypeId) === "—" ? null : jtName(journeyTypeId),
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
      // After create, go back to index for consistency
      router.push("/admin/routes");
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingId) return;
    if (!confirm("Delete this route?")) return;
    setMsg(null);
    const res = await fetch(`/api/admin/routes/${editingId}`, { method: "DELETE", headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setMsg(body?.error || `Delete failed (${res.status})`);
      return;
    }
    router.push("/admin/routes");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/admin/routes" className="rounded-full px-3 py-1 border text-sm">← Back</Link>
        <h1 className="text-2xl font-semibold">{isNew ? "New Route" : "Edit Route"}</h1>
        <div className="ml-auto flex items-center gap-2">
          {!isNew && (
            <button onClick={onDelete} className="rounded-full px-4 py-2 border text-sm">
              Delete
            </button>
          )}
        </div>
      </div>

      {msg && <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{msg}</div>}

      <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow">
        {loading ? (
          <div>Loading…</div>
        ) : (
          <form onSubmit={onSave} className="space-y-6">
            {/* Country */}
            <div>
              <label className="block text-sm text-neutral-600 mb-1">Country *</label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={countryId}
                onChange={(e) => {
                  setCountryId(e.target.value);
                  setPickupId("");
                  setDestinationId("");
                }}
              >
                <option value="">— Select —</option>
                {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {/* Desktop dropdowns */}
            <div className="hidden md:grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Pick-up Point *</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={pickupId}
                  onChange={(e) => setPickupId(e.target.value)}
                  disabled={!countryId}
                >
                  <option value="">— Select —</option>
                  {filteredPickups.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Destination *</label>
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={destinationId}
                  onChange={(e) => setDestinationId(e.target.value)}
                  disabled={!countryId}
                >
                  <option value="">— Select —</option>
                  {filteredDestinations.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>

            {/* Mobile tile pickers */}
            <div className="md:hidden space-y-6">
              <TileGrid
                title="Choose a pick-up point *"
                items={filteredPickups}
                selectedId={pickupId}
                onSelect={setPickupId}
                emptyHint={countryId ? "No pick-up points in this country yet." : "Pick a country first."}
              />
              <TileGrid
                title="Choose a destination *"
                items={filteredDestinations}
                selectedId={destinationId}
                onSelect={setDestinationId}
                emptyHint={countryId ? "No destinations in this country yet." : "Pick a country first."}
              />
            </div>

            {/* Collage */}
            <Collage left={pickup?.picture_url || null} right={destination?.picture_url || null} alt={routeName || "Route collage"} />

            {/* Metrics & names */}
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Route Name</label>
                <input className="w-full border rounded-lg px-3 py-2 bg-neutral-50" value={routeName} readOnly placeholder="Will auto-fill from selections" />
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

            {/* Journey type + season */}
            <div className="grid md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-neutral-600 mb-1">Journey Type{editingId ? "" : " *"}</label>
                <select className="w-full border rounded-lg px-3 py-2" value={journeyTypeId} onChange={(e) => setJourneyTypeId(e.target.value)}>
                  <option value="">— Select —</option>
                  {journeyTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
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
                className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
                disabled={
                  saving ||
                  !countryId ||
                  !pickupId ||
                  !destinationId ||
                  (!editingId && !journeyTypeId)
                }
              >
                {saving ? "Saving…" : editingId ? "Update Route" : "Create Route"}
              </button>
              <Link href="/admin/routes" className="inline-flex rounded-full px-4 py-2 border text-sm">Cancel</Link>
              {msg && <span className="text-sm text-neutral-600">{msg}</span>}
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
