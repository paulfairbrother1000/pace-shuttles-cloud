"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

/* ---------------- Theme (scoped to this page) ---------------- */
function Theme({ children }: { children: React.ReactNode }) {
  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      <style jsx global>{`
        .ps-theme {
          --bg: #0f1a2a;
          --card: #15243a;
          --border: #20334d;
          --text: #eaf2ff;
          --muted: #a3b3cc;
          --accent: #2a6cd6;
          --accent-contrast: #ffffff;
          --radius: 14px;
          --shadow: 0 6px 20px rgba(0,0,0,.25);
          color: var(--text);
          background: var(--bg);
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
        }
        .tile{background:var(--card);border-radius:var(--radius);box-shadow:var(--shadow)}
        .tile-border{box-shadow:0 0 0 1px var(--border) inset}
        .subtle-border{box-shadow:0 0 0 1px var(--border) inset}
        .pill{border-radius:9999px;padding:.4rem .75rem;font-size:.875rem;border:1px solid var(--border);background:transparent;color:var(--text)}
        .pill-active{background:var(--accent);color:var(--accent-contrast);border-color:transparent}
        .btn{border-radius:var(--radius);padding:.6rem .9rem;border:1px solid var(--border);background:var(--card);color:var(--text)}
        .btn-primary{background:var(--accent);color:var(--accent-contrast);border-color:transparent}
        .input{width:100%;border-radius:10px;padding:.6rem .75rem;background:var(--card);color:var(--text);box-shadow:0 0 0 1px var(--border) inset}
        .input::placeholder{color:var(--muted)}
        .label{margin-bottom:.25rem;display:block;font-size:.9rem;color:var(--muted)}
        .muted{color:var(--muted)}
        a{color:var(--text)} a:hover{color:var(--accent)}
      `}</style>
      {children}
    </div>
  );
}

/* ---------------- Supabase ---------------- */
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

  // ----- (NEW for "Other" country) -----
  const OTHER = "__OTHER__";
  const [otherCountryText, setOtherCountryText] = useState("");

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

  // ----- (NEW) dynamic label text -----
  const typeLabel =
    applicationType === "operator" ? "I am an…" : "I represent a…";

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
    if (countryId === OTHER && !otherCountryText.trim()) {
      setMsg("Please specify your country in the text box.");
      return;
    }

    if (applicationType === "operator") {
      if (!transportTypeId) { setMsg("Please choose a vehicle type."); return; }
    } else {
      if (!destinationTypeId) { setMsg("Please choose a destination type."); return; }
    }

    const payload: any = {
      application_type: applicationType,
      country_id:
        countryId === OTHER
          ? `Other - ${otherCountryText.trim()}`
          : (countryId || null),

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
      payload.place_ids = selectedPlaceIds;
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
      <Theme>
        <div className="mx-auto max-w-3xl p-6">
          <div className="tile tile-border p-6">
            <h1 className="text-2xl font-semibold mb-2">Thanks — we’ve got your application!</h1>
            <p className="muted">
              Your reference is <span className="font-mono">{submittedId.slice(0, 8)}</span>. Our team will review and be in touch.
            </p>
            <div className="mt-6">
              <a href="/" className="btn">Back to home</a>
            </div>
          </div>
        </div>
      </Theme>
    );
  }

  return (
    <Theme>
      <div className="mx-auto max-w-3xl p-6 space-y-4">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Partner with Pace Shuttles</h1>
          <p className="muted">Pace Shuttles is always on the lookout for extraordinary, world class destinations and exceptional providers of luxury travel.</p>
          <p className="muted">If you represent a licensed operator or destination, please get in touch using the form below and tell us more about your operation.</p>
          <p className="muted">If your operation is in a territory that’s not currently supported by Pace Shuttles, that’s no problem – you can be the first! We are keen to bring the Pace Shuttles benefits and experience to a wider audience.</p>
        </header>

        {msg && (
          <div className="rounded-md tile-border bg-[rgba(255,193,7,.12)] p-3 text-sm" style={{color:"#ffd88a"}}>
            {msg}
          </div>
        )}

        {loading ? (
          <div className="tile tile-border p-4">Loading…</div>
        ) : (
          <form onSubmit={onSubmit} className="tile tile-border p-5 space-y-5">
            {/* Type */}
            <div>
              <label className="label">{typeLabel}</label>
              <div className="flex gap-3">
                {(["operator","destination"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setApplicationType(t)}
                    className={`pill ${applicationType === t ? "pill-active" : ""}`}
                  >
                    {t === "operator" ? "Operator" : "Destination"}
                  </button>
                ))}
              </div>
            </div>

            {/* Country */}
            <div>
              <label className="label">Country of operation</label>
              <select
                className="input"
                value={countryId}
                onChange={(e) => {
                  const v = e.target.value;
                  setCountryId(v);
                  if (v !== OTHER) setOtherCountryText("");
                }}
                required
              >
                <option value="">Select country…</option>
                {countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value={OTHER}>Other</option>
              </select>

              {countryId === OTHER && (
                <div className="mt-2">
                  <input
                    className="input"
                    value={otherCountryText}
                    onChange={(e) => setOtherCountryText(e.target.value)}
                    placeholder="Type your country or territory…"
                  />
                  <p className="muted text-xs mt-1">
                    This will be submitted as <span className="font-mono">Other - [your text]</span>.
                  </p>
                </div>
              )}
            </div>

            {/* Operator-specific */}
            {applicationType === "operator" && (
              <div className="space-y-4">
                <div>
                  <label className="label">Vehicle Type</label>
                  <select
                    className="input"
                    value={transportTypeId}
                    onChange={(e) => { setTransportTypeId(e.target.value); setSelectedPlaceIds([]); }}
                    required
                  >
                    <option value="">Select vehicle type…</option>
                    {transportTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label">Arrival places supported (select any that apply)</label>
                  {transportTypeId ? (
                    filteredPlaces.length ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {filteredPlaces.map((p) => (
                          <label key={p.id} className="flex items-center gap-2 tile-border rounded-lg px-3 py-2">
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
                      <div className="text-sm muted">No places defined for this vehicle type (optional).</div>
                    )
                  ) : (
                    <div className="text-sm muted">Choose a vehicle type to see place options.</div>
                  )}
                </div>

                <div>
                  <label className="label">Number of vehicles in fleet</label>
                  <input
                    type="number"
                    min={0}
                    value={fleetSize}
                    onChange={(e) => setFleetSize(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value || "0", 10)))}
                    className="input"
                    placeholder="e.g., 3"
                  />
                </div>

                <div>
                  <label className="label">Pick-up suggestions (optional)</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={pickupSuggestions}
                    onChange={(e) => setPickupSuggestions(e.target.value)}
                    placeholder="If in the same country, you can choose known pick-ups from our list; add more ideas here."
                  />
                </div>

                <div>
                  <label className="label">Destination suggestions (optional)</label>
                  <textarea
                    className="input"
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
                  <label className="label">Destination Type</label>
                  <select
                    className="input"
                    value={destinationTypeId}
                    onChange={(e) => setDestinationTypeId(e.target.value)}
                    required
                  >
                    <option value="">Select destination type…</option>
                    {destinationTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label">Pick-up suggestions (optional)</label>
                  <textarea
                    className="input"
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
                <label className="label">Organisation Name</label>
                <input className="input" value={orgName} onChange={(e) => setOrgName(e.target.value)} required />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Organisation Address</label>
                <textarea className="input" rows={2} value={orgAddress} onChange={(e) => setOrgAddress(e.target.value)} />
              </div>
              <div>
                <label className="label">Telephone</label>
                <input className="input" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              </div>
              <div>
                <label className="label">Mobile</label>
                <input className="input" value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </div>
              <div>
                <label className="label">Email</label>
                <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <label className="label">Website</label>
                <input className="input" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>

              <div>
                <label className="label">Instagram</label>
                <input className="input" value={socialIG} onChange={(e) => setSocialIG(e.target.value)} placeholder="https://instagram.com/…" />
              </div>
              <div>
                <label className="label">YouTube</label>
                <input className="input" value={socialYT} onChange={(e) => setSocialYT(e.target.value)} placeholder="https://youtube.com/…" />
              </div>
              <div>
                <label className="label">X (Twitter)</label>
                <input className="input" value={socialX} onChange={(e) => setSocialX(e.target.value)} placeholder="https://x.com/…" />
              </div>
              <div>
                <label className="label">Facebook</label>
                <input className="input" value={socialFB} onChange={(e) => setSocialFB(e.target.value)} placeholder="https://facebook.com/…" />
              </div>

              <div>
                <label className="label">Contact Name</label>
                <input className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} />
              </div>
              <div>
                <label className="label">Role in Organisation</label>
                <input className="input" value={contactRole} onChange={(e) => setContactRole(e.target.value)} />
              </div>
              <div>
                <label className="label">Years of operation</label>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={yearsOperation}
                  onChange={(e) => setYearsOperation(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value || "0", 10)))}
                />
              </div>
            </div>

            <div>
              <label className="label">Description</label>
              <textarea
                className="input"
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
                className={`btn-primary ${submitting ? "opacity-70 cursor-not-allowed" : ""}`}
                style={{ display: "inline-block" }}
              >
                {submitting ? "Submitting…" : "Submit application"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Theme>
  );
}
