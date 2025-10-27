// src/lib/guardrails.ts

export type AgentContext = {
  signedIn: boolean;
  // future: operator_id, role, etc
};

export const DISALLOWED_TERMS = [
  // never disclose
  "operator name", "operator list", "captain name", "crew name",
  // add concrete examples if needed
  "Acme Boats", "Foo Transport", "Bar Aviation"
];

export function redact(text: string) {
  // simple redaction pattern for operator-like names; tighten as needed
  return text.replace(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(Operators?|Boats?|Transport|Aviation)\b/g, "[redacted operator]");
}

export function shouldDenyOperatorDisclosure(q: string) {
  const t = q.toLowerCase();
  return (
    t.includes("operator") ||
    t.includes("captain") ||
    t.includes("crew") ||
    DISALLOWED_TERMS.some(x => t.includes(x.toLowerCase()))
  );
}

export function preflightGate(q: string, ctx: AgentContext) {
  const lower = q.toLowerCase();

  // Booking/journey details require login
  const bookingLike =
    lower.includes("booking") ||
    lower.includes("journey") ||
    lower.includes("reservation") ||
    lower.includes("my ticket") ||
    lower.includes("my trip") ||
    lower.includes("cancel") ||
    lower.includes("refund");

  if (bookingLike && !ctx.signedIn) {
    return {
      action: "deflect" as const,
      message:
        "I can help with account-specific requests once you’re signed in. Please sign in, then I can look up your bookings or journeys.",
    };
  }

  // Operator disclosure never allowed
  if (shouldDenyOperatorDisclosure(lower)) {
    return {
      action: "deny" as const,
      message:
        "I can’t share operator, captain, or crew identities. I’m happy to help with routes, pickup points, schedules, or how Pace Shuttles works.",
    };
  }

  return { action: "ok" as const };
}

export function systemGuardrails(ctx: AgentContext) {
  return [
    "You are Pace Shuttles Support. Be concise, friendly, and accurate.",
    "Never disclose operator, captain, or crew names or identifying details.",
    "If asked about operators or staff identities, refuse and offer helpful alternatives.",
    ctx.signedIn
      ? "User is signed in. You may discuss bookings only if the user provides a booking reference or journey context; otherwise ask a short follow-up question."
      : "User is not signed in. Do not discuss their bookings or account history; kindly explain they need to sign in.",
    "Prefer answers grounded in provided context snippets. If unsure, say you’re unsure and suggest the next best step.",
    "Always use the brand name 'Pace Shuttles'.",
  ].join("\n");
}
