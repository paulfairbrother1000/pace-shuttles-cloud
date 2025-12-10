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
    // let the API default limit handle volume for now
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

function formatIsoDate(dateStr: string): string {
  // assume already YYYY-MM-DD, but keep for clarity/extensibility
  return dateStr;
}

/* -------------------------------------------------------------------------- */
/*  Booking tools                                                             */
/* -------------------------------------------------------------------------- */

export function bookingTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* 1) Journeys on a specific date */
  const listJourneysOnDate: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listJourneysOnDate",
        description:
          "Given a specific calendar date, list the live Pace Shuttles journeys scheduled on that day, including departure times and pickup/destination names. Use this when the user asks about a single day, e.g. 'on 18th December' or 'on 2024-12-18'.",
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
              content: `I couldn’t find any live journeys scheduled on ${formatIsoDate(
                rawDate
              )}. Please try another date or check back later as we add more departures.`,
            },
          ],
        };
      }

      const lines = journeys.map((j) => {
        const d = new Date(j.starts_at);
        const time = d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const pickup = j.pickup_name || "Pickup";
        const dest = j.destination_name || "Destination";
        return `• ${time} – ${pickup} → ${dest}`;
      });

      const content = [
        `Here are the live journeys I can see on ${formatIsoDate(rawDate)}:`,
        "",
        ...lines,
      ].join("\n");

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 2) Journeys across a date range (e.g. whole of December, over Christmas) */
  const listJourneysInPeriod: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listJourneysInPeriod",
        description:
          "List all live journeys within a date range (from_date to to_date). Use this when the user asks about 'in December', 'over Christmas', 'between X and Y', or 'during this week/month'.",
        parameters: {
          type: "object",
          properties: {
            from_date: {
              type: "string",
              description:
                "Start of the period in YYYY-MM-DD format (inclusive).",
            },
            to_date: {
              type: "string",
              description:
                "End of the period in YYYY-MM-DD format (inclusive).",
            },
            query: {
              type: "string",
              description:
                "Optional free-text filter to narrow results by pickup, destination, country or route name.",
            },
          },
          required: ["from_date", "to_date"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const fromRaw = String(args.from_date || "").trim();
      const toRaw = String(args.to_date || "").trim();
      const q = args.query ? String(args.query).trim() : "";

      if (!fromRaw || !toRaw) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Please provide both a start and end date in the format YYYY-MM-DD so I can list journeys in that period.",
            },
          ],
        };
      }

      const fromTs = new Date(`${fromRaw}T00:00:00Z`).getTime();
      const toTs = new Date(`${toRaw}T23:59:59.999Z`).getTime();

      const journeys = await fetchJourneys(baseUrl, {
        activeOnly: true,
        q: q || null,
      });

      if (!journeys || journeys.length === 0) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t find any live journeys in our public schedule yet. Please check back later as we add more departures.",
            },
          ],
        };
      }

      const inRange = journeys.filter((j) => {
        const t = new Date(j.starts_at).getTime();
        return t >= fromTs && t <= toTs;
      });

      if (!inRange.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live journeys scheduled between ${formatIsoDate(
                fromRaw
              )} and ${formatIsoDate(
                toRaw
              )}. Please try another period or check back later as we add more departures.`,
            },
          ],
        };
      }

      // sort by start time
      inRange.sort(
        (a, b) =>
          new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
      );

      const lines = inRange.map((j) => {
        const d = new Date(j.starts_at);
        const datePart = d.toISOString().slice(0, 10); // YYYY-MM-DD
        const time = d.toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const pickup = j.pickup_name || "Pickup";
        const dest = j.destination_name || "Destination";
        return `• ${datePart} ${time} – ${pickup} → ${dest}`;
      });

      const content = [
        `Here are the live journeys I can see between ${formatIsoDate(
          fromRaw
        )} and ${formatIsoDate(toRaw)}:`,
        "",
        ...lines,
      ].join("\n");

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 3) Booking flow explanation (unchanged) */
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

  return [listJourneysOnDate, listJourneysInPeriod, explainBookingFlow];
}
