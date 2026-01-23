// src/app/operator-admin/vehicles/edit/[id]/page.tsx

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { sb } from "@/lib/supabaseClient"; // ← shared client

/* ───────────────────────── Types ───────────────────────── */
type PsUser = {
  id: string;
  site_admin?: boolean | null;
  operator_admin?: boolean | null;
  operator_id?: string | null;
  operator_name?: string | null;
};

type Operator = { id: string; name: string };
type JourneyType = { id: string; name: string };
type OperatorTypeRel = { operator_id: string; journey_type_id: string };

type VehicleRow = {
  id: string;
  name: string;
  active: boolean | null;
  created_at: string;
  minseats: number;
  maxseats: number;
  minvalue: number;
  description: string;
  picture_url: string | null;
  min_val_threshold: number | null;
  type_id: string | null; // journey_types.id
  operator_id: string | null; // operators.id
};

/* NEW: staffing relationship rows */
type StaffRow = {
  id: string;
  operator_id: string;
  first_name: string | null;
  last_name: string | null;
  jobrole: string | null;
  active?: boolean | null; // if present in your schema
  photo_url: string | null;
};

type SVA = {
  id: string;
  operator_id: string;
  vehicle_id: string;
  staff_id: string;
  priority: number; // 1..5
  is_lead_eligible: boolean;
  created_at?: string | null;
};

/* ───────────────────────── NEW: Routes & Assignments ───────────────────────── */
type RouteRow = {
  id: string;
  name: string | null;
  route_name: string | null;
  pickup_id: string | null;
  destination_id: string | null;
  country_id: string | null;
  journey_type_id: string | null;
  is_active: boolean | null;
  pickup?: { id?: string; country_id?: string | null; name?: string | null } | null;
  destination?: { id?: string; country_id?: string | null; name?: string | null } | null;
};

type RVA = {
  id: string;
  route_id: string;
  vehicle_id: string;
  preferred: boolean;
  is_active: boolean;
  created_at?: string | null;

  // per-route overrides (NOT NULL per your new approach)
  minseats_override: number;
  maxseats_override: number;
  minvalue_override: number;
  min_val_threshold_override: number | null;
};

function routeDisplayName(r?: Partial<RouteRow> | null) {
  if (!r) return "—";
  return (r.route_name || r.name || "").trim() || (r as any).id || "—";
}

function inferRouteCountryId(
  r: RouteRow,
  pickupCountryById: Map<string, string>,
  destCountryById: Map<string, string>
): string | null {
  if (r.country_id) return r.country_id;

  const pu =
    r.pickup?.country_id ??
    (r.pickup_id ? pickupCountryById.get(r.pickup_id) : null);
  if (pu) return pu;

  const de =
    r.destination?.country_id ??
    (r.destination_id ? destCountryById.get(r.destination_id) : null);
  if (de) return de;

  return null;
}

/* ───────────────────────── Helpers ───────────────────────── */
const toInt = (v: string) => (v.trim() === "" ? null : Number.parseInt(v, 10));
const toFloat = (v: string) => (v.trim() === "" ? null : Number.parseFloat(v));
const isHttp = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

function isLeadRole(job?: string | null) {
  const j = String(job || "").toLowerCase();
  return j.includes("captain") || j.includes("pilot") || j.includes("driver");
}

/** Resolve storage path or raw URL into a browser-loadable URL. */
async function resolveImageUrl(pathOrUrl: string | null): Promise<string | null> {
  if (!pathOrUrl) return null;
  if (isHttp(pathOrUrl)) return pathOrUrl;
  const pub = sb.storage.from("images").getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await sb.storage
    .from("images")
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

function safeNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/* ───────────────────────── Page ───────────────────────── */
export default function EditVehiclePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const vehicleId = params?.id;
  const isNew = vehicleId === "new";

  /* ps_user (locks operator for operator admins) */
  const [psUser, setPsUser] = useState<PsUser | null>(null);
  const operatorLocked = !!(psUser?.operator_admin && psUser.operator_id);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("ps_user");
      setPsUser(raw ? (JSON.parse(raw) as PsUser) : null);
    } catch {
      setPsUser(null);
    }
  }, []);

  /* Lookups */
  const [operators, setOperators] = useState<Operator[]>([]);
  const [journeyTypes, setJourneyTypes] = useState<JourneyType[]>([]);
  const [opTypeRels, setOpTypeRels] = useState<OperatorTypeRel[]>([]);

  /* Form state */
  const [operatorId, setOperatorId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [name, setName] = useState("");
  const [minSeats, setMinSeats] = useState("");
  const [maxSeats, setMaxSeats] = useState("");
  const [minValue, setMinValue] = useState("");
  const [minValThreshold, setMinValThreshold] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [pictureFile, setPictureFile] = useState<File | null>(null);

  /* Image preview */
  const [storedImageUrl, setStoredImageUrl] = useState<string | null>(null);
  const livePreviewUrl = useMemo(
    () => (pictureFile ? URL.createObjectURL(pictureFile) : null),
    [pictureFile]
  );

  /* UI */
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /* Allowed types for selected operator */
  const allowedTypeIds = useMemo(
    () =>
      new Set(
        opTypeRels
          .filter((r) => r.operator_id === operatorId)
          .map((r) => r.journey_type_id)
      ),
    [opTypeRels, operatorId]
  );

  const allowedTypes = useMemo(
    () => journeyTypes.filter((t) => allowedTypeIds.has(t.id)),
    [journeyTypes, allowedTypeIds]
  );

  /* Load lookups + row */
  useEffect(() => {
    let off = false;
    (async () => {
      setLoading(true);

      const [ops, jts, rels] = await Promise.all([
        sb.from("operators").select("id,name").order("name"),
        sb.from("journey_types").select("id,name").order("name"),
        sb.from("operator_transport_types").select("operator_id,journey_type_id"),
      ]);

      if (ops.data) setOperators(ops.data as Operator[]);
      if (jts.data) setJourneyTypes(jts.data as JourneyType[]);
      if (rels.data) setOpTypeRels(rels.data as OperatorTypeRel[]);

      if (!isNew && vehicleId) {
        const { data, error } = await sb
          .from("vehicles")
          .select("*")
          .eq("id", vehicleId)
          .single();

        if (error || !data) {
          setMsg(error?.message ?? "Vehicle not found.");
        } else {
          const v = data as VehicleRow;
          setOperatorId(v.operator_id ?? "");
          setTypeId(v.type_id ?? "");
          setName(v.name ?? "");
          setMinSeats(String(v.minseats ?? ""));
          setMaxSeats(String(v.maxseats ?? ""));
          setMinValue(String(v.minvalue ?? ""));
          setMinValThreshold(String(v.min_val_threshold ?? ""));
          setDescription(v.description ?? "");
          setActive(v.active ?? true);

          const resolved = await resolveImageUrl(v.picture_url);
          setStoredImageUrl(resolved);
        }
      } else {
        // New: pre-fill operator if locked
        if (operatorLocked && psUser?.operator_id) {
          setOperatorId(psUser.operator_id);
        }
      }

      if (!off) setLoading(false);
    })();

    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicleId, isNew, operatorLocked, psUser?.operator_id]);

  /* Upload image -> return storage path */
  async function uploadImageIfAny(id: string): Promise<string | null> {
    if (!pictureFile) return null;
    const safe = pictureFile.name.replace(/[^\w.\-]+/g, "_");
    const path = `vehicles/${id}/${Date.now()}-${safe}`;
    const { error } = await sb.storage.from("images").upload(path, pictureFile, {
      cacheControl: "3600",
      upsert: true,
      contentType: pictureFile.type || "image/*",
    });
    if (error) {
      setMsg(`Image upload failed: ${error.message}`);
      return null;
    }
    return path;
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();

    try {
      setMsg(null);

      const effectiveOperatorId = operatorLocked ? psUser?.operator_id || "" : operatorId;
      if (!effectiveOperatorId) return setMsg("Please choose an Operator.");
      if (!name.trim()) return setMsg("Please enter a Vehicle name.");
      if (!typeId) return setMsg("Please select a Transport Type.");
      const minS = toInt(minSeats),
        maxS = toInt(maxSeats),
        minV = toFloat(minValue);
      if (minS == null || maxS == null || minV == null)
        return setMsg("Seats and Min Value are required.");

      setSaving(true);

      const basePayload: Record<string, any> = {
        operator_id: effectiveOperatorId,
        type_id: typeId,
        name: name.trim(),
        active,
        minseats: minS,
        maxseats: maxS,
        minvalue: minV,
        description: description.trim() || "",
        min_val_threshold: toFloat(minValThreshold),
      };

      if (isNew) {
        // Create
        const createRes = await fetch(`/api/admin/vehicles`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ ...basePayload, picture_url: null }),
        });
        if (!createRes.ok) {
          const body = await createRes.json().catch(() => ({}));
          setSaving(false);
          return setMsg(body?.error || `Create failed (${createRes.status})`);
        }
        const { id } = (await createRes.json()) as { id?: string };
        if (id && pictureFile) {
          const uploadedPath = await uploadImageIfAny(id);
          if (uploadedPath) {
            await fetch(`/api/admin/vehicles/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ picture_url: uploadedPath }),
            }).catch(() => {});
          }
        }
        router.push("/operator-admin/vehicles");
        return;
      }

      // Update existing
      const payload = { ...basePayload };
      const uploadedPath = await uploadImageIfAny(vehicleId!);
      if (uploadedPath) payload.picture_url = uploadedPath;

      const res = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaving(false);
        return setMsg(body?.error || `Update failed (${res.status})`);
      }

      // Refresh preview if we uploaded one
      if (uploadedPath) {
        const resolved = await resolveImageUrl(uploadedPath);
        setStoredImageUrl(resolved);
        setPictureFile(null);
      }

      setMsg("Updated ✅");
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (isNew || !vehicleId) return;
    if (!confirm("Delete this vehicle?")) return;

    try {
      setDeleting(true);
      const res = await fetch(`/api/admin/vehicles/${vehicleId}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setDeleting(false);
        return setMsg(body?.error || `Delete failed (${res.status})`);
      }
      router.push("/operator-admin/vehicles");
    } catch (err: any) {
      setMsg(err?.message ?? String(err));
      setDeleting(false);
    }
  }

  const operatorName =
    (operatorLocked &&
      (psUser?.operator_name || operators.find((o) => o.id === psUser?.operator_id)?.name)) ||
    "";

  /* ───────────────────── Captains & Priority (NEW) ───────────────────── */

  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [assignments, setAssignments] = useState<SVA[]>([]);
  const [relMsg, setRelMsg] = useState<string | null>(null);
  const [addingStaffId, setAddingStaffId] = useState<string>("");
  const [addingPriority, setAddingPriority] = useState<number>(3);

  // staff options: operator's active staff with a lead role, excluding already assigned
  const staffOptions = useMemo(() => {
    const already = new Set(assignments.map((a) => a.staff_id));
    return staff
      .filter((s) => s.operator_id === operatorId && isLeadRole(s.jobrole))
      .filter((s) => !already.has(s.id))
      .sort((a, b) =>
        `${a.last_name || ""} ${a.first_name || ""}`.localeCompare(
          `${b.last_name || ""} ${b.first_name || ""}`
        )
      );
  }, [staff, assignments, operatorId]);

  // display join
  const staffById = useMemo(() => {
    const m = new Map<string, StaffRow>();
    staff.forEach((s) => m.set(s.id, s));
    return m;
  }, [staff]);

  async function loadRelationships(opId: string, vId: string) {
    if (!opId || !vId || isNew) {
      setAssignments([]);
      setStaff([]);
      return;
    }
    setRelMsg(null);
    const [{ data: sva }, { data: st }] = await Promise.all([
      sb
        .from("vehicle_staff_prefs")
        .select("id,operator_id,vehicle_id,staff_id,priority,is_lead_eligible,created_at")
        .eq("operator_id", opId)
        .eq("vehicle_id", vId)
        .order("priority", { ascending: true }),
      sb
        .from("operator_staff")
        .select("id,operator_id,first_name,last_name,jobrole,photo_url,active")
        .eq("operator_id", opId),
    ]);
    setAssignments((sva as SVA[]) || []);
    setStaff((st as StaffRow[]) || []);
  }

  useEffect(() => {
    if (operatorId && vehicleId) {
      loadRelationships(operatorId, vehicleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operatorId, vehicleId]);

  async function addCaptain() {
    if (!operatorId || !vehicleId || !addingStaffId || isNew) return;
    setRelMsg(null);
    if (assignments.some((a) => a.staff_id === addingStaffId)) {
      setRelMsg("Already added.");
      return;
    }
    if (addingPriority < 1 || addingPriority > 5) {
      setRelMsg("Priority must be 1–5.");
      return;
    }
    const { error } = await sb.from("vehicle_staff_prefs").insert({
      operator_id: operatorId,
      vehicle_id: vehicleId,
      staff_id: addingStaffId,
      priority: addingPriority,
      is_lead_eligible: true,
    });
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAddingStaffId("");
    setAddingPriority(3);
    await loadRelationships(operatorId, vehicleId);
  }

  async function updatePriority(id: string, next: number) {
    if (next < 1 || next > 5) {
      setRelMsg("Priority must be 1–5.");
      return;
    }
    const { error } = await sb.from("vehicle_staff_prefs").update({ priority: next }).eq("id", id);
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAssignments((prev) => prev.map((r) => (r.id === id ? { ...r, priority: next } : r)));
  }

  async function toggleEligible(id: string, cur: boolean) {
    const { error } = await sb
      .from("vehicle_staff_prefs")
      .update({ is_lead_eligible: !cur })
      .eq("id", id);
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAssignments((prev) => prev.map((r) => (r.id === id ? { ...r, is_lead_eligible: !cur } : r)));
  }

  async function removeRel(id: string) {
    if (!confirm("Remove this captain from this vehicle?")) return;
    const { error } = await sb.from("vehicle_staff_prefs").delete().eq("id", id);
    if (error) {
      setRelMsg(error.message);
      return;
    }
    setAssignments((prev) => prev.filter((r) => r.id !== id));
  }

  const sortedAssignments = useMemo(
    () =>
      [...assignments].sort((a, b) =>
        a.priority !== b.priority
          ? a.priority - b.priority
          : (staffById.get(a.staff_id)?.last_name || "").localeCompare(
              staffById.get(b.staff_id)?.last_name || ""
            )
      ),
    [assignments, staffById]
  );

  /* ───────────────────── Journeys / Route Assignments (NEW) ───────────────────── */

  const [operatorCountryId, setOperatorCountryId] = useState<string | null>(null);

  // IMPORTANT:
  // - routesAll: unfiltered (type-only) so existing assignments can always display correct names
  // - routesForAdd: filtered to operator country (so add dropdown doesn't show Antigua/Barbados for BVI boats)
  const [routesAll, setRoutesAll] = useState<RouteRow[]>([]);
  const [routesForAdd, setRoutesForAdd] = useState<RouteRow[]>([]);
  const [routeAssignments, setRouteAssignments] = useState<RVA[]>([]);
  const [routesMsg, setRoutesMsg] = useState<string | null>(null);

  const [addingRouteId, setAddingRouteId] = useState<string>("");
  const [addingPreferred, setAddingPreferred] = useState<boolean>(false);

  // in-row edit cache
  const [editRva, setEditRva] = useState<Record<string, Partial<RVA>>>({});

  async function loadOperatorCountry(opId: string): Promise<string | null> {
    try {
      const { data, error } = await sb
        .from("operators")
        .select("id,country_id")
        .eq("id", opId)
        .maybeSingle();
      if (error) throw error;
      const cid = (data as any)?.country_id ?? null;
      const out = cid ? String(cid) : null;
      setOperatorCountryId(out);
      return out;
    } catch {
      setOperatorCountryId(null);
      return null;
    }
  }

  async function loadRoutesAndAssignments(opId: string, vId: string, vTypeId: string) {
    if (!opId || !vId || !vTypeId || isNew) {
      setRoutesAll([]);
      setRoutesForAdd([]);
      setRouteAssignments([]);
      return;
    }

    setRoutesMsg(null);

    // FIX: use opCountry immediately (state updates async)
    const opCountry = await loadOperatorCountry(opId);

    const [routesRes, rvaRes, puRes, deRes] = await Promise.all([
      sb
        .from("routes")
        .select(
          `
          id,name,route_name,pickup_id,destination_id,country_id,journey_type_id,is_active,
          pickup:pickup_id ( id, country_id, name ),
          destination:destination_id ( id, country_id, name )
        `
        )
        .eq("is_active", true)
        .eq("journey_type_id", vTypeId)
        .order("created_at", { ascending: false }),

      sb
        .from("route_vehicle_assignments")
        .select(
          "id,route_id,vehicle_id,preferred,is_active,created_at,minseats_override,maxseats_override,minvalue_override,min_val_threshold_override"
        )
        .eq("vehicle_id", vId)
        .eq("is_active", true)
        .order("created_at", { ascending: false }),

      sb.from("pickup_points").select("id,country_id"),
      sb.from("destinations").select("id,country_id"),
    ]);

    if (routesRes.error) setRoutesMsg(routesRes.error.message);
    if (rvaRes.error) setRoutesMsg((m) => m || rvaRes.error!.message);

    const pickupCountryById = new Map<string, string>();
    (puRes.data || []).forEach((p: any) => {
      if (p?.id && p?.country_id) pickupCountryById.set(String(p.id), String(p.country_id));
    });

    const destCountryById = new Map<string, string>();
    (deRes.data || []).forEach((d: any) => {
      if (d?.id && d?.country_id) destCountryById.set(String(d.id), String(d.country_id));
    });

    const allRoutes = (((routesRes.data as any[]) || []) as RouteRow[]).filter(
      (r) => r.is_active !== false
    );

    // Always keep unfiltered for correct display of assigned routes
    setRoutesAll(allRoutes);

    // Filter ONLY for add dropdown
    const filteredForAdd = opCountry
      ? allRoutes.filter(
          (r) => inferRouteCountryId(r, pickupCountryById, destCountryById) === opCountry
        )
      : allRoutes;

    setRoutesForAdd(filteredForAdd);

    const rvas = ((rvaRes.data as any[]) || []) as RVA[];
    setRouteAssignments(rvas);

    // seed edit cache
    const seed: Record<string, Partial<RVA>> = {};
    rvas.forEach((row) => (seed[row.id] = { ...row }));
    setEditRva(seed);
  }

  useEffect(() => {
    if (!isNew && operatorId && vehicleId && typeId) {
      loadRoutesAndAssignments(operatorId, vehicleId, typeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew, operatorId, vehicleId, typeId]);

  const routeById = useMemo(() => {
    const m = new Map<string, RouteRow>();
    routesAll.forEach((r) => m.set(r.id, r));
    return m;
  }, [routesAll]);

  const assignedRouteIds = useMemo(
    () => new Set(routeAssignments.map((a) => a.route_id)),
    [routeAssignments]
  );

  const addableRoutes = useMemo(() => {
    return routesForAdd
      .filter((r) => !assignedRouteIds.has(r.id))
      .sort((a, b) => routeDisplayName(a).localeCompare(routeDisplayName(b)));
  }, [routesForAdd, assignedRouteIds]);

  async function addRouteAssignment() {
    if (!vehicleId || !operatorId || !typeId || !addingRouteId || isNew) return;
    setRoutesMsg(null);

    const { error } = await sb.from("route_vehicle_assignments").insert({
      route_id: addingRouteId,
      vehicle_id: vehicleId,
      is_active: true,
      preferred: false,
    });

    if (error) {
      setRoutesMsg(error.message);
      return;
    }

    if (addingPreferred) {
      await setPreferredForThisVehicleOnRoute(addingRouteId, true);
    }

    setAddingRouteId("");
    setAddingPreferred(false);
    await loadRoutesAndAssignments(operatorId, vehicleId, typeId);
  }

  async function setPreferredForThisVehicleOnRoute(routeId: string, preferred: boolean) {
    if (!vehicleId) return;
    setRoutesMsg(null);

    // Keep uniqueness: clear all preferred on this route first (only if turning on)
    if (preferred) {
      const clear = await sb
        .from("route_vehicle_assignments")
        .update({ preferred: false })
        .eq("route_id", routeId)
        .eq("is_active", true);

      if (clear.error) {
        setRoutesMsg(clear.error.message);
        return;
      }
    }

    const upd = await sb
      .from("route_vehicle_assignments")
      .update({ preferred })
      .eq("route_id", routeId)
      .eq("vehicle_id", vehicleId)
      .eq("is_active", true);

    if (upd.error) {
      setRoutesMsg(upd.error.message);
      return;
    }

    // refresh local list
    setRouteAssignments((prev) =>
      prev.map((a) =>
        a.route_id === routeId
          ? { ...a, preferred: a.vehicle_id === vehicleId ? preferred : false }
          : a
      )
    );
  }

  function patchEditRva(id: string, patch: Partial<RVA>) {
    setEditRva((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }));
  }

  async function saveOverrides(rvaId: string) {
    setRoutesMsg(null);

    const next = editRva[rvaId];
    if (!next) return;

    // Your rule: fields should have meaningful values. 0 makes no sense here.
    const ms = Number(next.minseats_override);
    const mx = Number(next.maxseats_override);
    const mv = Number(next.minvalue_override);

    if (!Number.isFinite(ms) || ms <= 0) return setRoutesMsg("Min seats override must be > 0.");
    if (!Number.isFinite(mx) || mx <= 0) return setRoutesMsg("Max seats override must be > 0.");
    if (mx < ms) return setRoutesMsg("Max seats override must be >= min seats override.");
    if (!Number.isFinite(mv) || mv <= 0) return setRoutesMsg("Min value override must be > 0.");

    const th =
      next.min_val_threshold_override == null ||
      String(next.min_val_threshold_override).trim() === ""
        ? null
        : Number(next.min_val_threshold_override);

    const { error } = await sb
      .from("route_vehicle_assignments")
      .update({
        minseats_override: ms,
        maxseats_override: mx,
        minvalue_override: mv,
        min_val_threshold_override: th,
      })
      .eq("id", rvaId);

    if (error) {
      setRoutesMsg(error.message);
      return;
    }

    setRouteAssignments((prev) =>
      prev.map((a) => (a.id === rvaId ? { ...a, ...(next as any) } : a))
    );
    setRoutesMsg("Saved ✅");
  }

  async function resetOverridesToVehicle(rvaId: string) {
    const ms = toInt(minSeats);
    const mx = toInt(maxSeats);
    const mv = toFloat(minValue);
    const th = toFloat(minValThreshold);

    if (ms == null || mx == null || mv == null) {
      setRoutesMsg("Vehicle seats/min value must be set before reset.");
      return;
    }

    patchEditRva(rvaId, {
      minseats_override: ms,
      maxseats_override: mx,
      minvalue_override: mv,
      min_val_threshold_override: th,
    });

    await saveOverrides(rvaId);
  }

  async function removeRouteAssignment(rvaId: string) {
    if (!confirm("Remove this route from this vehicle?")) return;
    setRoutesMsg(null);

    // Soft disable
    const { error } = await sb
      .from("route_vehicle_assignments")
      .update({ is_active: false, preferred: false })
      .eq("id", rvaId);

    if (error) {
      setRoutesMsg(error.message);
      return;
    }

    setRouteAssignments((prev) => prev.filter((a) => a.id !== rvaId));
  }

  const basePerSeat = useMemo(() => {
    const ms = toInt(minSeats);
    const mv = toFloat(minValue);
    if (!ms || !mv || ms <= 0 || mv <= 0) return null;
    return Math.ceil(mv / ms);
  }, [minSeats, minValue]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link
          href="/operator-admin/vehicles"
          className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm"
        >
          ← Back
        </Link>
        {!isNew && (
          <button
            onClick={onDelete}
            className="rounded-full border px-3 py-2 text-sm"
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        )}
      </div>

      <header>
        <h1 className="text-2xl font-semibold">
          {loading ? "Loading…" : isNew ? "New Vehicle" : "Edit Vehicle"}
        </h1>
      </header>

      {/* Preview image */}
      <section className="rounded-2xl border bg-white p-4 shadow">
        <div className="grid md:grid-cols-3 gap-4">
          <div className="md:col-span-3">
            <div className="w-full rounded-2xl overflow-hidden border">
              {/* live preview takes precedence */}
              {livePreviewUrl ? (
                <img
                  src={livePreviewUrl}
                  alt="New upload preview"
                  className="w-full h-48 sm:h-60 object-cover"
                  style={{ objectPosition: "50% 40%" }}
                />
              ) : storedImageUrl ? (
                <img
                  src={storedImageUrl}
                  alt="Vehicle image"
                  className="w-full h-48 sm:h-60 object-cover"
                  style={{ objectPosition: "50% 40%" }}
                />
              ) : (
                <div className="w-full h-48 sm:h-60 grid place-items-center text-neutral-400">
                  No image
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Form */}
      <section className="rounded-2xl border bg-white p-5 shadow">
        <form onSubmit={onSave} className="space-y-5">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-2">
              <label className="block text-sm text-neutral-600 mb-1">
                Operator *
              </label>
              {operatorLocked ? (
                <div className="inline-flex rounded-full bg-neutral-100 border px-3 py-2 text-sm">
                  {operatorName || psUser?.operator_id}
                </div>
              ) : (
                <select
                  className="w-full border rounded-lg px-3 py-2"
                  value={operatorId}
                  onChange={(e) => {
                    setOperatorId(e.target.value);
                    setTypeId("");
                  }}
                >
                  <option value="">— Select —</option>
                  {operators.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Transport Type *
              </label>
              <select
                className="w-full border rounded-lg px-3 py-2"
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                disabled={!operatorId}
              >
                <option value="">— Select —</option>
                {allowedTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Vehicle Name *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Min Seats *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="numeric"
                value={minSeats}
                onChange={(e) => setMinSeats(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Max Seats *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="numeric"
                value={maxSeats}
                onChange={(e) => setMaxSeats(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Min Value *
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="decimal"
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Min Value Threshold
              </label>
              <input
                className="w-full border rounded-lg px-3 py-2"
                inputMode="decimal"
                value={minValThreshold}
                onChange={(e) => setMinValThreshold(e.target.value)}
              />
            </div>
          </div>

          {/* quick display of base per seat */}
          {basePerSeat != null && (
            <div className="text-sm text-neutral-600">
              Current vehicle base price:{" "}
              <span className="font-medium">£{basePerSeat}</span> per seat
              (minvalue/minseats)
            </div>
          )}

          <div>
            <label className="block text-sm text-neutral-600 mb-1">
              Description
            </label>
            <textarea
              className="w-full border rounded-lg px-3 py-2"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-neutral-600 mb-1">
                Picture
              </label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPictureFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-neutral-500 mt-1">
                Stored in bucket <code>images</code> at{" "}
                <code>vehicles/&lt;vehicleId&gt;/</code>
              </p>
            </div>

            <div className="flex items-end">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
                <span className="text-sm">Active</span>
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={
                saving ||
                !operatorId ||
                !typeId ||
                !name.trim() ||
                toInt(minSeats) == null ||
                toInt(maxSeats) == null ||
                toFloat(minValue) == null
              }
              className="inline-flex rounded-full px-4 py-2 bg-black text-white text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : isNew ? "Create Vehicle" : "Update Vehicle"}
            </button>
            <Link
              href="/operator-admin/vehicles"
              className="inline-flex rounded-full px-4 py-2 border text-sm"
            >
              Cancel
            </Link>
            {msg && <span className="text-sm text-neutral-600">{msg}</span>}
          </div>
        </form>
      </section>

      {/* NEW: Captains & Priority */}
      {!isNew && (
        <section className="rounded-2xl border bg-white p-5 shadow space-y-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">Captains & Priority</h2>
            {relMsg && <span className="text-sm text-red-600">{relMsg}</span>}
          </div>

          {/* Add line */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border rounded-lg px-3 py-2"
              value={addingStaffId}
              onChange={(e) => setAddingStaffId(e.target.value)}
              disabled={!operatorId}
            >
              <option value="">Add captain…</option>
              {staffOptions.map((s) => {
                const nm =
                  `${s.last_name || ""} ${s.first_name || ""}`.trim() ||
                  "Unnamed";
                return (
                  <option key={s.id} value={s.id}>
                    {nm}
                  </option>
                );
              })}
            </select>

            <label className="text-sm">Priority</label>
            <select
              className="border rounded-lg px-2 py-1"
              value={addingPriority}
              onChange={(e) => setAddingPriority(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  P{n}
                </option>
              ))}
            </select>

            <button
              className="px-3 py-2 rounded border"
              disabled={!addingStaffId || !vehicleId || !operatorId}
              onClick={addCaptain}
              type="button"
            >
              Add
            </button>
          </div>

          {/* Current list */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Captain</th>
                  <th className="text-left p-3">Role</th>
                  <th className="text-left p-3">Priority</th>
                  <th className="text-left p-3">Lead-eligible</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedAssignments.length === 0 ? (
                  <tr>
                    <td className="p-3" colSpan={5}>
                      No captains linked to this vehicle yet.
                    </td>
                  </tr>
                ) : (
                  sortedAssignments.map((r) => {
                    const st = staffById.get(r.staff_id);
                    const nm = st
                      ? `${st.last_name || ""} ${st.first_name || ""}`.trim() ||
                        "Unnamed"
                      : `#${r.staff_id.slice(0, 8)}`;
                    return (
                      <tr key={r.id} className="border-t">
                        <td className="p-3">{nm}</td>
                        <td className="p-3">{st?.jobrole || "—"}</td>
                        <td className="p-3">
                          <select
                            className="border rounded px-2 py-1"
                            value={r.priority}
                            onChange={(e) =>
                              updatePriority(r.id, Number(e.target.value))
                            }
                          >
                            {[1, 2, 3, 4, 5].map((n) => (
                              <option key={n} value={n}>
                                P{n}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-3">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={r.is_lead_eligible}
                              onChange={() =>
                                toggleEligible(r.id, r.is_lead_eligible)
                              }
                            />
                            <span className="text-sm">
                              {r.is_lead_eligible ? "Yes" : "No"}
                            </span>
                          </label>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            className="px-3 py-1 rounded border"
                            onClick={() => removeRel(r.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* NEW: Journeys (Route assignments + per-route overrides) */}
      {!isNew && (
        <section className="rounded-2xl border bg-white p-5 shadow space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">
              Journeys (Route assignments)
            </h2>

            {routesMsg && (
              <span className="text-sm text-neutral-600">{routesMsg}</span>
            )}

            {!operatorCountryId && (
              <span className="text-xs text-amber-700">
                Note: operator country unknown (operators.country_id not
                available) — filtering by vehicle type only.
              </span>
            )}
          </div>

          {/* Add route */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="border rounded-lg px-3 py-2"
              value={addingRouteId}
              onChange={(e) => setAddingRouteId(e.target.value)}
              disabled={!operatorId || !typeId}
            >
              <option value="">Add route…</option>
              {addableRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {routeDisplayName(r)}
                </option>
              ))}
            </select>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={addingPreferred}
                onChange={(e) => setAddingPreferred(e.target.checked)}
              />
              Preferred for this route
            </label>

            <button
              className="px-3 py-2 rounded border"
              disabled={!addingRouteId || !vehicleId}
              onClick={addRouteAssignment}
              type="button"
            >
              Add
            </button>
          </div>

          {/* Existing assignments */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="text-left p-3">Route</th>
                  <th className="text-left p-3">Preferred</th>
                  <th className="text-left p-3">Min seats</th>
                  <th className="text-left p-3">Max seats</th>
                  <th className="text-left p-3">Min value (£)</th>
                  <th className="text-left p-3">Threshold</th>
                  <th className="text-left p-3">Base £/seat</th>
                  <th className="text-right p-3">Actions</th>
                </tr>
              </thead>

              <tbody>
                {routeAssignments.length === 0 ? (
                  <tr>
                    <td className="p-3" colSpan={8}>
                      No routes assigned to this vehicle yet.
                    </td>
                  </tr>
                ) : (
                  routeAssignments.map((a) => {
                    const r = routeById.get(a.route_id);
                    const e = (editRva[a.id] || a) as any;

                    const ms = safeNum(
                      e.minseats_override ?? a.minseats_override,
                      0
                    );
                    const mv = safeNum(
                      e.minvalue_override ?? a.minvalue_override,
                      0
                    );
                    const base =
                      ms > 0 && mv > 0 ? Math.ceil(mv / ms) : null;

                    // FIX: avoid showing the same route label twice
                    const topLabel = routeDisplayName(r);
                    const subLabel =
                      r?.pickup?.name && r?.destination?.name
                        ? `${r.pickup.name} → ${r.destination.name}`.trim()
                        : "";
                    const showSub =
                      !!subLabel &&
                      topLabel !== "—" &&
                      subLabel.toLowerCase() !== topLabel.toLowerCase();

                    return (
                      <tr key={a.id} className="border-t">
                        <td className="p-3">
                          <div className="font-medium">{topLabel}</div>
                          {showSub && (
                            <div className="text-xs text-neutral-500">
                              {subLabel}
                            </div>
                          )}
                        </td>

                        <td className="p-3">
                          <label className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={!!a.preferred}
                              onChange={(ev) =>
                                setPreferredForThisVehicleOnRoute(
                                  a.route_id,
                                  ev.target.checked
                                )
                              }
                            />
                            <span className="text-sm">
                              {a.preferred ? "Yes" : "No"}
                            </span>
                          </label>
                        </td>

                        <td className="p-3">
                          <input
                            className="w-24 border rounded px-2 py-1"
                            inputMode="numeric"
                            value={String(e.minseats_override ?? "")}
                            onChange={(ev) =>
                              patchEditRva(a.id, {
                                minseats_override: Number(ev.target.value),
                              })
                            }
                          />
                        </td>

                        <td className="p-3">
                          <input
                            className="w-24 border rounded px-2 py-1"
                            inputMode="numeric"
                            value={String(e.maxseats_override ?? "")}
                            onChange={(ev) =>
                              patchEditRva(a.id, {
                                maxseats_override: Number(ev.target.value),
                              })
                            }
                          />
                        </td>

                        <td className="p-3">
                          <input
                            className="w-28 border rounded px-2 py-1"
                            inputMode="decimal"
                            value={String(e.minvalue_override ?? "")}
                            onChange={(ev) =>
                              patchEditRva(a.id, {
                                minvalue_override: Number(ev.target.value),
                              })
                            }
                          />
                        </td>

                        <td className="p-3">
                          <input
                            className="w-24 border rounded px-2 py-1"
                            inputMode="decimal"
                            value={String(e.min_val_threshold_override ?? "")}
                            onChange={(ev) =>
                              patchEditRva(a.id, {
                                min_val_threshold_override:
                                  ev.target.value.trim() === ""
                                    ? null
                                    : Number(ev.target.value),
                              })
                            }
                          />
                        </td>

                        <td className="p-3">
                          {base == null ? "—" : `£${base}`}
                        </td>

                        <td className="p-3 text-right whitespace-nowrap">
                          <button
                            className="px-3 py-1 rounded border mr-2"
                            onClick={() => saveOverrides(a.id)}
                            type="button"
                          >
                            Save
                          </button>

                          <button
                            className="px-3 py-1 rounded border mr-2"
                            onClick={() => resetOverridesToVehicle(a.id)}
                            type="button"
                          >
                            Reset
                          </button>

                          <button
                            className="px-3 py-1 rounded border"
                            onClick={() => removeRouteAssignment(a.id)}
                            type="button"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
