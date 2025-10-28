// src/lib/policy.ts
export type RefundBand = "FULL_MINUS_FEES" | "FIFTY_PERCENT" | "NO_REFUND";

export function daysHoursUntil(departureISO: string, now = new Date()) {
  const dep = new Date(departureISO);
  const ms  = dep.getTime() - now.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  return { days, hours, ms, dep };
}

/** Pace Shuttles client policy:
 *  - ≥72h before departure: full refund minus bank fees
 *  - 24–72h: 50% refund
 *  - <24h: no refund
 *  - Reschedule allowed within 6 months if seats exist
 */
export function evaluateCancellation(departureISO: string, now = new Date()) {
  const { days, hours, ms, dep } = daysHoursUntil(departureISO, now);
  const totalHours = Math.ceil(ms / (1000 * 60 * 60));
  let band: RefundBand;
  if (totalHours >= 72) band = "FULL_MINUS_FEES";
  else if (totalHours >= 24) band = "FIFTY_PERCENT";
  else band = "NO_REFUND";

  return {
    band,
    totalHours,
    humanWindow:
      band === "FULL_MINUS_FEES" ? "72+ hours before departure" :
      band === "FIFTY_PERCENT"   ? "between 24 and 72 hours before departure" :
                                   "less than 24 hours before departure",
    rescheduleWindowHint: "You can reschedule the same journey within 6 months, subject to seat availability.",
    departureISO,
    departureLocal: dep.toLocaleString(),
  };
}

export function bandToFriendly(band: RefundBand) {
  switch (band) {
    case "FULL_MINUS_FEES":
      return "a full refund minus any bank fees charged to Pace Shuttles";
    case "FIFTY_PERCENT":
      return "a 50% refund of the booking value";
    default:
      return "no refund (no-shows or late arrivals are treated as travelled)";
  }
}
