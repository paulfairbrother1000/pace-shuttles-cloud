// src/lib/agent/tools/searchKB.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/**
 * KB / “knowledge” tools.
 *
 * These do NOT hit the DB. They’re used for:
 *  - Brand / high-level “what is Pace Shuttles?” questions.
 *  - Very general policy / T&Cs style questions.
 *
 * All hard factual, data-driven answers (where we operate, routes, schedules,
 * prices, etc.) must still come from the catalog / journeys / quote tools.
 */

export function kbTools(_ctx: ToolContext): ToolDefinition[] {
  /* ------------------------------------------------------------------------ */
  /*  1) Brand overview – used for “what is Pace Shuttles?”                   */
  /* ------------------------------------------------------------------------ */

  const kbBrandOverview: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "kb_brand_overview",
        description:
          "Give a high-level explanation of what Pace Shuttles is as a brand. " +
          "Use this when the user asks things like 'what is Pace Shuttles', " +
          "'tell me about Pace Shuttles', or 'how does Pace Shuttles work', " +
          "and they are clearly not asking for specific routes, dates or prices.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const content =
        "Pace Shuttles is a luxury, semi-private transfer service that connects " +
        "guests to premium coastal and island destinations – think beach clubs, " +
        "restaurants, hotels, marinas and anchorages – rather than generic city " +
        "buses or airport shuttles.\n\n" +
        "Our tagline is “Luxury Transfers, Reimagined.” Journeys are typically " +
        "operated as shared or private charters in premium categories of " +
        "transport such as modern speed boats today, with scope for other " +
        "high-end options like helicopters, limousines or premium road vehicles " +
        "as new territories come online. The Pace Shuttles platform focuses on " +
        "easy, per-seat booking, transparent pricing and operator-agnostic " +
        "service – guests book with Pace Shuttles, not directly with individual " +
        "boat or vehicle owners.\n\n" +
        "If you’d like details about specific countries, destinations, routes or " +
        "journey dates, ask me about those and I’ll use the live schedule and " +
        "catalog tools to give an up-to-date answer.";

      return {
        messages: [{ role: "assistant", content }],
      };
    },
  };

  /* ------------------------------------------------------------------------ */
  /*  2) Generic policy / T&Cs summary                                       */
  /* ------------------------------------------------------------------------ */

  const kbPolicySummary: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "kb_policy_summary",
        description:
          "Give a high-level, non-legal summary of policies (e.g. terms and " +
          "conditions, cancellations, changes, safety, or luggage rules). " +
          "Use this when the user asks about 'terms', 'T&Cs', 'cancellation " +
          "policy', 'refunds' or similar. Always remind the user that the full " +
          "legal Terms & Conditions are shown during the booking process.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "User’s policy-related question, e.g. 'what is your cancellation policy'.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const raw = String(args.query || "").toLowerCase();

      // Very light-touch tailoring based on the question,
      // but keep everything generic and legally non-binding.
      let body =
        "Pace Shuttles follows clear Terms & Conditions that are shown in full " +
        "during the booking process. The summary below is for guidance only and " +
        "does not replace the legal T&Cs you agree to when you book.\n\n";

      if (raw.includes("cancel") || raw.includes("refund")) {
        body +=
          "• **Cancellations & changes:** Bookings can typically be changed or cancelled " +
          "up to a defined cutoff before departure, after which fees or loss of fare may apply.\n" +
          "• **No-shows & late arrivals:** If guests arrive late or do not show up, the fare " +
          "is usually non-refundable because the seats have been reserved for that journey.\n";
      } else if (raw.includes("safety")) {
        body +=
          "• **Safety:** Journeys are operated by professional, licensed operators who are " +
          "responsible for the safe operation of their vessels or vehicles.\n" +
          "• **Requirements on board:** Guests are expected to follow crew instructions, " +
          "including the use of lifejackets or other safety equipment where required.\n";
      } else if (raw.includes("luggage") || raw.includes("baggage")) {
        body +=
          "• **Luggage:** Space on board is limited. There are usually clear guidelines " +
          "about how much luggage you can bring and what items are restricted.\n" +
          "• **Damage / loss:** Operators are not typically responsible for normal wear, " +
          "minor damage or loss to personal items unless required by local law.\n";
      } else {
        body +=
          "Typical areas covered include how bookings are confirmed, what happens if a " +
          "journey is changed or cancelled by the guest or by the operator, safety and " +
          "conduct on board, and how complaints or issues are handled.\n";
      }

      body +=
        "\nFor anything binding or detailed, always refer to the full Pace Shuttles Terms " +
        "and Conditions shown on the website at the time of booking – those are the " +
        "authoritative version.";

      return {
        messages: [{ role: "assistant", content: body }],
      };
    },
  };

  return [kbBrandOverview, kbPolicySummary];
}
