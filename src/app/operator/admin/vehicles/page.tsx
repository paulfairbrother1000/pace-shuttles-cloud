import { redirect } from "next/navigation";

/**
 * Legacy passthrough for old menu links:
 * /operator/admin/vehicles  ->  /operator-admin/vehicles
 * Preserves any query string.
 */
export default function LegacyOperatorVehicles({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      if (Array.isArray(v)) v.forEach((val) => val != null && qs.append(k, String(val)));
      else if (v != null) qs.append(k, String(v));
    }
  }
  const to = `/operator-admin/vehicles${qs.size ? `?${qs.toString()}` : ""}`;
  redirect(to);
}
