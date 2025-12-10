// src/lib/agent/tools/bookings.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/* -------------------------------------------------------------------------- */
/*  Types for /api/public/journeys                                            */
/* -------------------------------------------------------------------------- */

type PublicJourney = {
  starts_at: string;
  pickup_name: string | null;
  destination_name: string | null;
  country_name?: string | null;
};

/* Helper to call the public journeys API */
async function fetchJourneys(
  baseUrl: string,
  params: { date?: string; q?: string | null; activeOnly?: boolean }
): Promise<PublicJourney[] | null> {
  try {
    const url = new URL(`${baseUrl}/api/public/journeys`);
    if (params.activeOnly !== false) {
      url.searchParams.set("active", "true");
    }
    if (params.date) {
      url.searchParams.set("date", params.date);
    }
    if (params.q) {
      url.searchParams.set("q", params.q);
    }

    const res = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as {
      ok: boolean;
      rows?: PublicJourney[];
    };

    if (!json.ok || !Array.isArray(json.rows)) {
      return null;
    }

    return json.rows;
  } catch {
    return null;
  }
}

/* Format a date to YYYY-MM-DD for messages */
function formatDateForText(dateStr: string): string {
  if (!dateStr) return "";
  // Assume already YYYY-MM-DD, but keep this in case we want nicer formatting later
  return dateStr;
}

/* -------------------------------------------------------------------------- */
/*  Booking tools                                                             */
/* -------------------------------------------------------------------------- */

export function bookingTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* 1) List journeys on a specific date */
  const listJourneysOnDate: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listJourneysOnDate",
        description:
          "Given a specific calendar date, list the live Pace Shuttles journeys scheduled on that day, including departure times and pickup/destination names.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "The calendar date in YYYY-MM-DD format (e.g. '2024-12-18').",
            },
            query: {
              type: "string",
              description:
                "Optional free-text filter to narrow results by pickup, destination, country or route name.",
            },
          },
          required: ["date"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const rawDate = String(args.date || "").trim();
      const q = args.query ? String(args.query).trim() : "";

      if (!rawDate) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Please provide a specific date in the format YYYY-MM-DD so I can check the schedule.",
            },
          ],
        };
      }

      const journeys = await fetchJourneys(baseUrl, {
        date: rawDate,
        q: q || null,
        activeOnly: true,
      });

      if (!journeys || journeys.length === 0) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live journeys scheduled on ${formatDateForText(
                rawDate
              )}. Please try another date or check back later as we add more departures.`,
            },
          ],
        };
      }

      const lines = journeys.map((j) => {
        const d = new Date(j.starts_at);
        // Use a neutral 24h time; the site can clarify exact local timezones elsewhere
        const time = d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });

        const pickup = j.pickup_name || "Pickup";
        const dest = j.destination_name || "Destination";
        return `• ${time} – ${pickup} → ${dest}`;
      });

      const content = [
        `Here are the live journeys I can see on ${formatDateForText(rawDate)}:`,
        "",
        ...lines,
      ].join("\n");

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 2) Explain the booking flow (existing behaviour) */
  const explainBookingFlow: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "explainBookingFlow",
        description:
          "Explain how a customer actually books a shuttle on the Pace Shuttles website, without creating or modifying any bookings.",
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

  return [listJourneysOnDate, explainBookingFlow];
}
