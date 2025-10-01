// src/lib/flags.ts
export function crewOpsEnabled(): boolean {
  // Read once at runtime; defaults to false if missing.
  return String(process.env.NEXT_PUBLIC_CREW_OPS_ENABLED).toLowerCase() === "true";
}
