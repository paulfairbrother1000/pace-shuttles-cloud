// src/app/partners/page.tsx
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

type Country = { id: string; name: string };
type TransportType = { id: string; name: string; is_active?: boolean | null };
type DestinationType = { id: string; name: string; is_active?: boolean | null };
type Place = { id: string; name: string; transport_type_id: string };

export default function PartnersApplyPage() {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  const [countries, setCountries] = useState<Country[]>([]);
  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [destinationTypes, setDestinationTypes] = useState<DestinationType[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);

  // Form state
  const [applicationType, setApplicationType] = useState<"operator" | "destination">("operator");
  const [countryId, setCountryId] = useState<string>("");

  // Operator
  const [transportTypeId, setTransportTypeId] = useState<string>("");
  const [fleetSize, setFleetSize] = useState<number | "">("");
  const [selectedPlaceIds, setSelectedPlaceIds] = useState<string[]>([]);

  // Destination
  const [destinationTypeId, setDestinationTypeId] = useState<string>("");

  // Common suggestions
  const [pickupSuggestions, setPickupSuggestions] = useState("");
  const [destinationSuggestions, setDestinationSuggestions] = useState("");

  // Org & contact
  const [orgName, setOrgName] = useState("");
  const [orgAddress, setOrgAddress] = useState("");
  const [telephone, setTelephone] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [socialIG, setSocialIG] = useState("");
  const [socialYT, setSocialYT] = useState("");
  const [socialX, setSocialX] = useState("");
  const [socialFB, setSocialFB] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [yearsOperation, setYearsOperation] = useState<number | "">("");

  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  // Load lookups
  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) { setLoading(false); setMsg("Supabase not configured."); return; }
      setLoading(true);
      setMsg(null);

      try {
        const [c, t, d] = await Promise.all([
          supabase.from("countries").select("id,name").order("name"),
          supabase.from("transport_types").select("id,name,is_active").order("name"),
          supabase.from("destination_types").select("id,name,is_active").order("name"),
        ]);

        if (off) return;

        if (c.error || t.error || d.error) {
          setMsg(c.error?.message || t.error?.message || d.error?.message || "Load failed");
          setLoading(false);
          return;
        }

        setCountries((c.data as Country[]) || []);
        setTransportTypes(((t.data as TransportType[]) || []).filter(x => x.is_active !== false));
        setDestinationTypes(((d.data as DestinationType[]) || []).filter(x => x.is_active !== false));
      } catch (e: any) {
        setMsg(e?.message || "Error loading data");
      } finally {
        setLoading(false);
      }
    })();
    return () => { off = true; };
  }, []);

  // Load arrival places for chosen transport type (operator flow)
  useEffect(() => {
    let off = false;
    (async () => {
      if (!supabase) return;
      if (!transportTypeId) { setPlaces([]); return; }
      const { data, error } = await supabase
        .from("transport_type_places")
        .select("id,name,transport_type_id")
        .eq("transport_type_id", transportTypeId)
        .order("name");

      if (off) return;
      if (error) { setMsg(error.message); setPlaces([]); return; }
      setPlaces((data as Place[]) || []);
    })();
    return () => { off = true; };
  }, [transportTypeId]);

  const filteredPlaces = useMemo(() => places, [places]);

  const togglePlace = (id: string) => {
    setSelectedPlaceIds((prev) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    // Quick client-side checks
    if (!orgName.trim()) {
      setMsg("Organisation Name is required.");
      return;
    }
    if (!countryId) {
      setMsg("Please choose a country of operation.");
      return;
    }

    if (applicationType === "operator") {
      if (!transportTypeId) { setMsg("Please choose a vehicle type."); return; }
    } else {
      if (!destinationTypeId) { setMsg("Please choose a destination type."); return; }
    }

    const payload: any = {
      application_type: applicationType,
      country_id: countryId || null,

      // org
      org_name: orgName,
      org_address: orgAddress,
      telephone,
      mobile,
      email,
      website,
      social_instagram: socialIG,
      social_youtube: socialYT,
      social_x: socialX,
      social_facebook: socialFB,
      contact_name: contactName,
      contact_role: contactRole,
      years_operation: yearsOperation === "" ? null : Number(yearsOperation),

      // suggestions
      pickup_suggestions: pickupSuggestions,
      destination_suggestions: destinationSuggestions,

      description,
    };

    if (applicationType === "operator") {
      payload.transport_type_id = transportTypeId;
      payload.fleet_size = fleetSize === "" ? null : Number(fleetSize);
      payload.place_ids = selectedPlaceIds; // arrival places for that transport type
    } else {
      payload.destination_type_id = destinationTypeId;
    }

    try {
      setSubmitting(true);
      const res = await fetch("/api/partner-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setMsg(json?.error || `Submit failed (${res.status})`);
        return;
      }
      setSubmittedId(json.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setMsg(e?.message || "Submit failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold mb-2">Thanks — we’ve got your application!</h1>
          <p className="text-neutral-700">
            Your reference is <span className="font-mono">{submittedId.slice(0, 8)}</span>. Our team will review and be in touch.
          </p>
          <div className="mt-6">
            <a href="/" className="inline-block rounded-lg border px-4 py-2 hover:bg-neutral-50">Back to home</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight">Partner with Pace Shuttles</h1>
        
<p className="text-neutral-600">Pace Shuttles is always on the lookout for extraordinary, world class destinations and exceptional providers of luxury travel.</p>
<p className="text-neutral-600">If you represent a licensed operator or destination, please get in touch using the form below and tell us more about your operation.</p>
<p className="text-neutral-600">If your operation is in a territory that’s not currently supported by Pace Shuttles, that’s no problem – you can be the first! We are keen to bring the Pace Shuttles benefits and experience to a wider audience.</p>
      </header>

      {msg && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {msg}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border p-4">Loading…</div>
      ) : (
        <form onSubmit={onSubmit} className="rounded-2xl border bg-white p-5 shadow-sm space-y-5">
          {/* Type */}
          <div>
            <label className="mb-2 block text-sm font-medium">I am a…</label>
            <div className="flex gap-3">
              {(["operator","destination"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setApplicationType(t)}
                  className={
                    "rounded-xl border px-3 py-1.5 text-sm " +
                    (applicationType === t ? "bg-neutral-900 text-white border-neutral-900" : "bg-white hover:bg-neutral-50")
                  }
                >
                  {t === "operator" ? "Operator" : "Destination"}
                </button>
              ))}
            </div>
          </div>

          {/* Country */}
          <div>
            <label className="mb-1 block text-sm font-medium">Country of operation</label>
            <select
              className="w-full rounded-lg border px-3 py-2"
              value={countryId}
              onChange={(e) => setCountryId(e.target.value)}
              required
            >
              <option value="">Select country…</option>
              {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Operator-specific */}
          {applicationType === "operator" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Vehicle Type</label>
                <select
                  className="w-full rounded-lg border px-3 py-2"
                  value={transportTypeId}
                  onChange={(e) => { setTransportTypeId(e.target.value); setSelectedPlaceIds([]); }}
                  required
                >
                  <option value="">Select vehicle type…</option>
                  {transportTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Arrival places supported (select any that apply)</label>
                {transportTypeId ? (
                  filteredPlaces.length ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {filteredPlaces.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={selectedPlaceIds.includes(p.id)}
                            onChange={() => togglePlace(p.id)}
                          />
                          <span className="text-sm">{p.name}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-neutral-600">No places defined for this vehicle type (optional).</div>
                  )
                ) : (
                  <div className="text-sm text-neutral-600">Choose a vehicle type to see place options.</div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Number of vehicles in fleet</label>
                <input
                  type="number"
                  min={0}
                  value={fleetSize}
                  onChange={(e) => setFleetSize(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value || "0", 10)))}
                  className="w-full rounded-lg border px-3 py-2"
                  placeholder="e.g., 3"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Pick-up suggestions (optional)</label>
                <textarea
                  className="w-full rounded-lg border px-3 py-2"
                  rows={3}
                  value={pickupSuggestions}
                  onChange={(e) => setPickupSuggestions(e.target.value)}
                  placeholder="If in the same country, you can choose known pick-ups from our list; add more ideas here."
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Destination suggestions (optional)</label>
                <textarea
                  className="w-full rounded-lg border px-3 py-2"
                  rows={3}
                  value={destinationSuggestions}
                  onChange={(e) => setDestinationSuggestions(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Destination-specific */}
          {applicationType === "destination" && (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">Destination Type</label>
                <select
                  className="w-full rounded-lg border px-3 py-2"
                  value={destinationTypeId}
                  onChange={(e) => setDestinationTypeId(e.target.value)}
                  required
                >
                  <option value="">Select destination type…</option>
                  {destinationTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Pick-up suggestions (optional)</label>
                <textarea
                  className="w-full rounded-lg border px-3 py-2"
                  rows={3}
                  value={pickupSuggestions}
                  onChange={(e) => setPickupSuggestions(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* Org & contact */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Organisation Name</label>
              <input className="w-full rounded-lg border px-3 py-2" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium">Organisation Address</label>
              <textarea className="w-full rounded-lg border px-3 py-2" rows={2} value={orgAddress} onChange={(e) => setOrgAddress(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Telephone</label>
              <input className="w-full rounded-lg border px-3 py-2" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Mobile</label>
              <input className="w-full rounded-lg border px-3 py-2" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Email</label>
              <input type="email" className="w-full rounded-lg border px-3 py-2" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Website</label>
              <input className="w-full rounded-lg border px-3 py-2" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Instagram</label>
              <input className="w-full rounded-lg border px-3 py-2" value={socialIG} onChange={(e) => setSocialIG(e.target.value)} placeholder="https://instagram.com/…" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">YouTube</label>
              <input className="w-full rounded-lg border px-3 py-2" value={socialYT} onChange={(e) => setSocialYT(e.target.value)} placeholder="https://youtube.com/…" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">X (Twitter)</label>
              <input className="w-full rounded-lg border px-3 py-2" value={socialX} onChange={(e) => setSocialX(e.target.value)} placeholder="https://x.com/…" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Facebook</label>
              <input className="w-full rounded-lg border px-3 py-2" value={socialFB} onChange={(e) => setSocialFB(e.target.value)} placeholder="https://facebook.com/…" />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">Contact Name</label>
              <input className="w-full rounded-lg border px-3 py-2" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Role in Organisation</label>
              <input className="w-full rounded-lg border px-3 py-2" value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Years of operation</label>
              <input
                type="number"
                min={0}
                className="w-full rounded-lg border px-3 py-2"
                value={yearsOperation}
                onChange={(e) => setYearsOperation(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value || "0", 10)))}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Description</label>
            <textarea
              className="w-full rounded-lg border px-3 py-2"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us about your offering, experience, and price points."
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={submitting}
              className={
                "rounded-lg px-4 py-2 text-white " +
                (submitting ? "bg-neutral-500" : "bg-blue-600 hover:bg-blue-700")
              }
            >
              {submitting ? "Submitting…" : "Submit application"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
