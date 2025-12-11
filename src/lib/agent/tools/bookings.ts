// src/lib/agent/tools/bookings.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/* -------------------------------------------------------------------------- */
/*  Helpers for date validation                                               */
/* -------------------------------------------------------------------------- */

function isValidIsoDate(dateStr: string): boolean {
  // Must be YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;

  const year = parseInt(dateStr.slice(0, 4), 10);
  const month = parseInt(dateStr.slice(5, 7), 10);
  const day = parseInt(dateStr.slice(8, 10), 10);

  // Sensible year range for our schedules
  if (Number.isNaN(year) || year < 2024 || year > 2035) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false; // coarse check; JS Date will do the rest

  const d = new Date(dateStr + "T00:00:00Z");
  // Ensure Date didn't wrap (e.g. 2024-02-31)
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() + 1 === month &&
    d.getUTCDate() === day
  );
}

function toUtcMidnight(dateStr: string): number {
  return new Date(dateStr + "T00:00:00Z").getTime();
}

function toUtcEndOfDay(dateStr: string): number {
  return new Date(dateStr + "T23:59:59.999Z").getTime();
}

/* -------------------------------------------------------------------------- */
/*  Public type for journeys API                                              */
/* -------------------------------------------------------------------------- */

type PublicJourneyRow = {
  starts_at: string;
  pickup_name: string | null;
  destination_name: string | null;
  country_name: string | null;
};

/* -------------------------------------------------------------------------- */
/*  Tools                                                                      */
/* -------------------------------------------------------------------------- */

export function bookingTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* ---------------------------------------------------------------------- */
  /* 1) Explain booking flow (unchanged)                                   */
  /* ---------------------------------------------------------------------- */

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

  /* ---------------------------------------------------------------------- */
  /* 2) Search journeys by date / date-range (future only)                 */
  /* ---------------------------------------------------------------------- */

  const searchJourneysByDateRange: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "searchJourneysByDateRange",
        description:
          "Look up live journeys in the public catalog for a given date or date range. Only returns future journeys; past dates are rejected.",
        parameters: {
          type: "object",
          properties: {
            date: {
              type: "string",
              description:
                "Single date in YYYY-MM-DD format (e.g. 2025-12-18). If provided, start_date and end_date are ignored.",
            },
            start_date: {
              type: "string",
              description:
                "Start of the date range in YYYY-MM-DD format (inclusive).",
            },
            end_date: {
              type: "string",
              description:
                "End of the date range in YYYY-MM-DD format (inclusive).",
            },
          },
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayTs = toUtcMidnight(todayStr);

      const rawDate =
        typeof args.date === "string" && args.date.trim()
          ? args.date.trim()
          : undefined;
      const rawStart =
        typeof args.start_date === "string" && args.start_date.trim()
          ? args.start_date.trim()
          : undefined;
      const rawEnd =
        typeof args.end_date === "string" && args.end_date.trim()
          ? args.end_date.trim()
          : undefined;

      let startStr: string | undefined;
      let endStr: string | undefined;

      // Normalise: if "date" provided, treat as single-day range
      if (rawDate) {
        startStr = rawDate;
        endStr = rawDate;
      } else if (rawStart && rawEnd) {
        startStr = rawStart;
        endStr = rawEnd;
      } else if (rawStart || rawEnd) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "To search journeys, please provide either a single date (YYYY-MM-DD) or a full range with both start and end dates.",
            },
          ],
        };
      } else {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "To look up journeys in the schedule, please tell me a specific date (YYYY-MM-DD) or a date range.",
            },
          ],
        };
      }

      // Validate ISO format and sensible year range
      if (!isValidIsoDate(startStr) || !isValidIsoDate(endStr)) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I can only search the schedule using calendar dates in the format YYYY-MM-DD between 2024 and 2035. Please check the dates and try again.",
            },
          ],
        };
      }

      // Convert to timestamps and ensure ordering
      let startTs = toUtcMidnight(startStr);
      let endTs = toUtcEndOfDay(endStr);

      if (endTs < startTs) {
        // Swap if user gave them backwards
        [startStr, endStr] = [endStr, startStr];
        [startTs, endTs] = [toUtcMidnight(startStr), toUtcEndOfDay(endStr)];
      }

      // Reject past-only queries (we only show future schedule)
      if (endTs < todayTs) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "The public schedule view only shows upcoming journeys. For past trips you’ll be able to review your bookings when logged in. Please choose a date from today onwards.",
            },
          ],
        };
      }

      // If the range starts in the past but ends in the future, clamp it to today
      if (startTs < todayTs) {
        startTs = todayTs;
        startStr = todayStr;
      }

      // Fetch all active journeys and filter client-side
      try {
        const res = await fetch(
          `${baseUrl}/api/public/journeys?active=true&limit=500`,
          {
            cache: "no-store",
            headers: { Accept: "application/json" },
          }
        );

        if (!res.ok) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "I couldn’t reach the live schedule right now. Please try again in a moment.",
              },
            ],
          };
        }

        const json = (await res.json()) as {
          ok: boolean;
          rows?: PublicJourneyRow[];
        };

        if (!json.ok || !json.rows) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "I couldn’t read the live journey data just now. Please try again shortly.",
              },
            ],
          };
        }

        const rows = json.rows
          .filter((r) => {
            const t = new Date(r.starts_at).getTime();
            return t >= startTs && t <= endTs;
          })
          .sort(
            (a, b) =>
              new Date(a.starts_at).getTime() -
              new Date(b.starts_at).getTime()
          );

        if (!rows.length) {
          const content = `I couldn’t find any live journeys scheduled between ${startStr} and ${endStr}. Please try another period or check back later as we add more departures.`;
          return { messages: [{ role: "assistant", content }] };
        }

        const lines = rows.map((r) => {
          const dt = new Date(r.starts_at);
          const datePart = dt.toISOString().slice(0, 10); // YYYY-MM-DD
          const timePart = dt.toISOString().slice(11, 16); // HH:MM
          const from = r.pickup_name || "Unknown pickup";
          const to = r.destination_name || "Unknown destination";
          return `${datePart} ${timePart} – ${from} → ${to}`;
        });

        const content =
          `Here are the live journeys I can see between ${startStr} and ${endStr}:\n• ` +
          lines.join("\n• ");

        return { messages: [{ role: "assistant", content }] };
      } catch (e) {
        console.error("searchJourneysByDateRange error:", e);
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Something went wrong while looking up the live schedule. Please try again.",
            },
          ],
        };
      }
    },
  };

  return [explainBookingFlow, searchJourneysByDateRange];
}
