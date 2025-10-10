// src/lib/opsAssign.ts
"use client";

/**
 * Call the server to assign (or reassign) a LEAD for a journey+vehicle.
 * If staffId is omitted, the server auto-picks using fair-use.
 *
 * Returns the assignment_id on success.
 */
export async function assignLead(
  journeyId: string,
  vehicleId: string,
  staffId?: string
): Promise<string> {
  const res = await fetch("/api/ops/assign/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      journey_id: journeyId,
      vehicle_id: vehicleId,
      ...(staffId ? { staff_id: staffId } : {}),
    }),
  });

  if (!res.ok) {
    let msg = `Assign failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }

  const body = await res.json();
  return body.assignment_id as string;
}
