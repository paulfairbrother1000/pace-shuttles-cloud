// src/lib/guardrails.ts

export type AgentContext = {
  signedIn: boolean;
  // future: operator_id, role, etc.
};

/* ---------------------------- Redaction & privacy --------------------------- */

export const DISALLOWED_TERMS = [
  // generic roles
  "operator", "operators", "captain", "captains", "crew", "skipper", "pilot",
  // common leak-y asks
  "operator list", "crew list", "captain list", "contact details", "phone number", "email address",
  // example placeholders (add real ones if they ever leak into docs)
  "Acme Boats", "Foo Transport", "Bar Aviation"
];

export function redact(text: string) {
  // redact "X Y Operators|Boats|Transport|Aviation" etc.
  const opPat = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+(Operators?|Boats?|Transport|Aviation)\b/g;
  // redact simple emails/phones if they slip into snippets
  const emailPat = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
  const phonePat = /\+?\d[\d\s().-]{6,}\d/g;
  return text.replace(opPat, "[redacted operator]")
             .replace(emailPat, "[redacted email]")
             .replace(phonePat, "[redacted phone]");
}

export function shouldDenyOperatorDisclosure(q: string) {
  const t = q.toLowerCase();
  return (
    /operator|captain|crew|skipper|pilot/.test(t) ||
    DISALLOWED_TERMS.some(x => t.includes(x.toLowerCase()))
  );
}

/* --------------------------------- Gating ---------------------------------- */

export function preflightGate(q: string, ctx: AgentContext) {
  const lower = q.toLowerCase();

  // Anything that implies account lookups or booking actions
  const bookingLike =
    /\b(booking|order|ticket|journey|reservation|reference|ref|qid|quote|checkout|payment|refund|cancel|reschedule|change|amend)\b/.test(lower);

  if (bookingLike && !ctx.signedIn) {
    return {
      action: "deflect" as const,
      message:
        "I can help with booking-specific requests once you’re signed in. Please sign in so I can securely look up your journeys, quotes, or tickets.",
    };
  }

  if (shouldDenyOperatorDisclosure(lower)) {
    return {
      action: "deny" as const,
      message:
        "I can’t share operator, captain, or crew identities or their contact details. I’m happy to help with routes, pickup points, schedules, prices, or how Pace Shuttles works.",
    };
  }

  return { action: "ok" as const };
}

/* ------------------------------- System prompt ------------------------------ */

export function systemGuardrails(ctx: AgentContext) {
  return [
    // Role & tone
    "You are Pace Shuttles Support—an expert concierge. Be warm, concise, and pragmatic. Lead with the answer, then give a short why/how.",
    "Prefer brief bullets over long paragraphs. Avoid marketing fluff.",
    "Do everything in your power to establish exactly what the client is trying to achieve and how you can help them to achieve it.",
    "",

    // Knowledge & citations
    "Ground answers in the provided context snippets (vector/file search). If you relied on a snippet, append a one-line source tag like: (From: Title › Section).",
    "If context is missing or weak, say so briefly and ask ONE targeted follow-up question, or offer to create a support ticket.",
    "",

    // Pricing & SSOT
    "Prices, availability, and quotes must come ONLY from the SSOT endpoints. Never invent numbers.",
    "When the user asks about prices/‘how much’/cheapest options, instruct the tool layer to call /api/quote with the specific route/date/qty. Carry the HMAC quoteToken through the flow. Do NOT fabricate tokens.",
    "",

    // Concierge flow for cancellations/refunds
    "For cancellation/refund questions: ask whether they have a booking and the journey date/time. If they provide a date, compute days to departure and explain the refund outcome according to policy snippets. Offer reschedule if policy allows and capacity exists. If they provide a booking reference, require sign-in before any lookup.",
    "Always ask if there's anything else you can assist with once you have solved the clients case.",
    "",

    // Login boundary
    ctx.signedIn
      ? "User is signed in: you may reference their own bookings/tickets only when they explicitly provide details (e.g., booking ref). If details are missing, ask for the minimum needed."
      : "User is not signed in: do NOT discuss their bookings or account history. Explain that sign-in is required for privacy.",
    "",

    // Privacy & operator safety
    "Never disclose operators’, captains’, or crew identities or contact details. If asked, refuse politely and pivot to helpful alternatives (e.g., route info, schedules, how to book). If any snippet includes such details, redact them.",
    "",

    // General style rules
    "Always use the brand name “Pace Shuttles.”",
    "When suggesting next steps, be explicit (e.g., “Sign in → share your booking ref → I’ll check refund options”).",
  ].join("\n");
}
