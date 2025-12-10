// src/lib/agent/tools/bookings.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/* -------------------------------------------------------------------------- */
/*  Types we expect from /api/public/journeys                                 */
/* -------------------------------------------------------------------------- */

type PublicJourney = {
  id: string;
  route_name: string | null;
  country_name: string | null;
  pickup_name: string | null;
  destination_name: string | null;
  departure_time: string; // ISO timestamp
};

/* -------------------------------------------------------------------------- */
/*  Shared fetch helper                                                       */
/* -------------------------------------------------------------------------- */

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Booking Tools                                                             */
/* -------------------------------------------------------------------------- */

export function bookingTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* ---------------------------------------------------------------------- */
  /* 1) Explain booking flow (existing tool)                                */
  /* ---------------------------------------------------------------------- */
  const explainBookingFlow: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "explainBookingFlow",
        description:
          "Explain how a customer books a shuttle on the Pace Shuttles website, without creating or modifying bookings.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const content =
        "To book a shuttle, you use the main Pace Shuttles website: choose your country, destination, date, time and party size, then follow the steps to confirm and pay. I can answer questions about the flow, but I don’t create or change bookings directly from chat yet.";
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* ---------------------------------------------------------------------- */
  /* 2) NEW: listJourneysByDate – real date-based schedule lookup           */
  /* ---------------------------------------------------------------------- */
  const listJourneysByDate: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listJourneysByDate",
        description:
          "Given a calendar date, list any live Pace Shuttles journeys running on that date, including pickup, destination, and departure time. Use this whenever the user asks about journeys or schedules for a specific day.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "Date in ISO format YYYY-MM-DD (e.g. '2025-12-18').",
            },
          },
          required: ["date"],
          additionalProperties: false,
        },
      },
    },

    run: async (args: any): Promise<ToolExecutionResult> => {
      const rawDate = String(args.date || "").trim();

      if (!rawDate) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t tell which date you meant. Please ask again with a specific date, for example: ‘Do you have any journeys on 18 December 2025?’",
            },
          ],
        };
      }

      // Query your public API
      const data = await fetchJSON<{ rows: PublicJourney[] }>(
        `${baseUrl}/api/public/journeys?date=${encodeURIComponent(rawDate)}`
      );

      const journeys = data?.rows ?? [];

      if (!journeys.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live journeys scheduled on ${rawDate}. Please try another date or check back later as we add more departures.`,
            },
          ],
        };
      }

      // Format list of journeys
      const lines = journeys.map((j) => {
        const pickup = j.pickup_name ?? "Pickup point";
        const dest = j.destination_name ?? "destination";
        const time = new Date(j.departure_time).toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `• ${pickup} → ${dest} at ${time}`;
      });

      const content =
        `Here are the journeys we currently have scheduled on ${rawDate}:\n` +
        lines.join("\n");

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* ---------------------------------------------------------------------- */
  /* Export tools                                                           */
  /* ---------------------------------------------------------------------- */
  return [explainBookingFlow, listJourneysByDate];
}
