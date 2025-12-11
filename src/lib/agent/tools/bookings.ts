// src/lib/agent/tools/bookings.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";
import type { AgentChoice } from "@/lib/agent/agent-schema";

/* -------------------------------------------------------------------------- */
/*  Types for /api/public/journeys                                            */
/* -------------------------------------------------------------------------- */

type JourneyRow = {
  starts_at: string;
  pickup_name: string | null;
  destination_name: string | null;
  country_name: string | null;
  route_name?: string | null;
};

type JourneysResponse = {
  ok: boolean;
  rows: JourneyRow[];
  count: number;
};

/* -------------------------------------------------------------------------- */
/*  Date helpers                                                              */
/* -------------------------------------------------------------------------- */

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function endOfMonth(year: number, monthIdx: number): Date {
  // monthIdx is 0-based; day 0 of next month is the last day of this month
  return new Date(year, monthIdx + 1, 0);
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function formatDateTimeISO(s: string): { date: string; time: string } {
  const dt = new Date(s);
  const iso = dt.toISOString();
  return {
    date: iso.slice(0, 10),
    time: iso.slice(11, 16),
  };
}

/**
 * Parse a "date-ish" string coming from the model.
 *
 * Supports:
 * - "2025-12-18" (ISO date)
 * - "December" / "december"
 * - "December 2025"
 *
 * For month-only values with no year:
 * - If month is after current month -> that month, current year (full month)
 * - If month is the current month -> tomorrow to end of that month
 * - If month is before current month -> that month, next year (full month)
 */
function inferDateRange(
  fromRaw: string,
  toRaw?: string
): { start: Date; end: Date } | { error: string } {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);

  const from = (fromRaw || "").trim();
  const to = (toRaw || "").trim();

  const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

  // Case 1: both explicit ISO dates
  if (isoDateRegex.test(from) && isoDateRegex.test(to)) {
    const start = startOfDay(new Date(from + "T00:00:00Z"));
    const end = startOfDay(new Date(to + "T00:00:00Z"));

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { error: "I couldn’t understand those dates." };
    }

    if (end < start) {
      return { error: "The end date must be on or after the start date." };
    }

    const earliest = tomorrow;
    if (end < earliest) {
      return {
        error:
          "The public schedule view only shows upcoming journeys. For past trips you’ll be able to review your bookings when logged in. Please choose a date from today onwards.",
      };
    }

    const adjustedStart = start < earliest ? earliest : start;
    return { start: adjustedStart, end };
  }

  // Helper: parse "Month" or "Month YYYY"
  const monthMatch = from.toLowerCase().match(
    /^([a-z]+)(?:\s+(\d{4}))?$/
  );

  if (monthMatch) {
    const monthName = monthMatch[1];
    const monthIdx = MONTHS.indexOf(monthName);
    if (monthIdx === -1) {
      return { error: "I couldn’t understand that month." };
    }

    const yearStr = monthMatch[2];
    const thisYear = today.getFullYear();
    const thisMonth = today.getMonth();

    let year: number;

    if (yearStr) {
      year = parseInt(yearStr, 10);
    } else {
      // No year: infer like a human would
      if (monthIdx > thisMonth) {
        year = thisYear; // later this year
      } else if (monthIdx === thisMonth) {
        year = thisYear; // this month
      } else {
        year = thisYear + 1; // next year
      }
    }

    let start: Date;
    let end: Date;

    if (!yearStr && monthIdx === thisMonth) {
      // "December" when we're already in December:
      // from tomorrow to end of December
      start = tomorrow;
      end = endOfMonth(year, monthIdx);
    } else {
      // Whole month in the inferred year
      start = new Date(year, monthIdx, 1);
      end = endOfMonth(year, monthIdx);
    }

    const earliest = tomorrow;
    if (end < earliest) {
      return {
        error:
          "The public schedule view only shows upcoming journeys. For past trips you’ll be able to review your bookings when logged in. Please choose a date from today onwards.",
      };
    }

    if (start < earliest) start = earliest;

    return { start, end };
  }

  // Fallback: single explicit ISO date only
  if (isoDateRegex.test(from)) {
    const start = startOfDay(new Date(from + "T00:00:00Z"));
    const end = start;

    const earliest = tomorrow;
    if (end < earliest) {
      return {
        error:
          "The public schedule view only shows upcoming journeys. For past trips you’ll be able to review your bookings when logged in. Please choose a date from today onwards.",
      };
    }

    const adjustedStart = start < earliest ? earliest : start;
    return { start: adjustedStart, end };
  }

  return { error: "I couldn’t understand the dates you asked for." };
}

/* -------------------------------------------------------------------------- */
/*  Fetch helper                                                              */
/* -------------------------------------------------------------------------- */

async function fetchJourneysForRange(
  baseUrl: string,
  start: Date,
  end: Date,
  q: string
): Promise<JourneyRow[]> {
  const all: JourneyRow[] = [];

  for (
    let cursor = new Date(start.getTime());
    cursor <= end;
    cursor = addDays(cursor, 1)
  ) {
    const dateStr = formatDate(cursor);
    const params = new URLSearchParams({
      active: "true",
      date: dateStr,
    });
    if (q) params.set("q", q);

    try {
      const res = await fetch(
        `${baseUrl}/api/public/journeys?${params.toString()}`,
        {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }
      );

      if (!res.ok) continue;

      const data = (await res.json()) as JourneysResponse;
      if (!data.ok || !Array.isArray(data.rows)) continue;

      all.push(...data.rows);
    } catch {
      // swallow per-day errors; we’ll just show what we have
      continue;
    }
  }

  // Ensure chronological order just in case
  all.sort(
    (a, b) =>
      new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime()
  );

  return all;
}

/* -------------------------------------------------------------------------- */
/*  Tools                                                                     */
/* -------------------------------------------------------------------------- */

export function bookingTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* ------------------------------------------------------------------------ */
  /* 1) Explain booking flow (no DB access)                                   */
  /* ------------------------------------------------------------------------ */

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
        "To book a shuttle, use the main Pace Shuttles website: choose your country, destination, date, time and party size, then follow the steps to confirm and pay. I can answer questions about the flow, but I don’t create or change bookings directly from chat yet.";
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* ------------------------------------------------------------------------ */
  /* 2) List journeys between dates (or in a month)                           */
  /* ------------------------------------------------------------------------ */

  const listJourneysBetweenDates: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listJourneysBetweenDates",
        description:
          "Look up live, upcoming journeys in a given date range using the public schedule. Use this when the user asks things like 'what journeys do you have on 18th December?', 'in December?', 'over Christmas?', or 'in January next year?'. For month-only questions, set `from` to the month name (e.g. 'December' or 'January') and leave `to` empty; the backend will infer the exact dates: if the month is the current month, it will search from tomorrow to the end of that month; if it's earlier than the current month, it will assume next year.",
        parameters: {
          type: "object",
          properties: {
            from: {
              type: "string",
              description:
                "Required. Start of the range: either 'YYYY-MM-DD' or a month phrase like 'December' or 'December 2025'.",
            },
            to: {
              type: "string",
              description:
                "Optional. End of the range: 'YYYY-MM-DD'. Usually omitted for month-only questions.",
            },
            q: {
              type: "string",
              description:
                "Optional free-text filter for pickup, destination or route name (e.g. 'Boom', 'The Cliff', 'Barbados').",
            },
          },
          required: ["from"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const fromRaw = String(args.from || "").trim();
      const toRaw = args.to ? String(args.to).trim() : "";
      const q = args.q ? String(args.q).trim() : "";

      if (!fromRaw) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Please tell me which date or month you’re interested in so I can look up journeys.",
            },
          ],
        };
      }

      const range = inferDateRange(fromRaw, toRaw);

      if ("error" in range) {
        return {
          messages: [
            {
              role: "assistant",
              content: range.error,
            },
          ],
        };
      }

      const { start, end } = range;
      const journeys = await fetchJourneysForRange(baseUrl, start, end, q);

      const startStr = formatDate(start);
      const endStr = formatDate(end);

      if (!journeys.length) {
        const base =
          q && q.length
            ? `I couldn’t find any live journeys to or from places matching “${q}” between ${startStr} and ${endStr}.`
            : `I couldn’t find any live journeys scheduled between ${startStr} and ${endStr}.`;
        const tail =
          " Please try another period or check back later as we add more departures.";
        return {
          messages: [
            {
              role: "assistant",
              content: base + tail,
            },
          ],
        };
      }

      // Build human-readable lines + clickable choices
      const lines: string[] = [];
      const choices: AgentChoice[] = [];

      // You can change this base path later to whatever route you build
      const JOURNEY_LINK_BASE = "/journeys";

      journeys.forEach((j) => {
        const { date, time } = formatDateTimeISO(j.starts_at);
        const pickup = j.pickup_name || "Pickup";
        const dest = j.destination_name || "Destination";

        const label = `${date} ${time} — ${pickup} → ${dest}`;
        lines.push(`• ${label}`);

        const url = `${JOURNEY_LINK_BASE}?date=${encodeURIComponent(
          date
        )}&pickup=${encodeURIComponent(
          pickup
        )}&destination=${encodeURIComponent(dest)}`;

        choices.push({
          label,
          action: {
            type: "openJourney",
            date,
            time,
            pickup,
            destination: dest,
            url,
          },
        });
      });

      const heading =
        `Here are the live journeys I can see between ${startStr} and ${endStr}` +
        (q ? ` matching “${q}”` : "") +
        ":\n";

      const content = heading + lines.join("\n");

      return {
        messages: [{ role: "assistant", content }],
        choices,
      };
    },
  };

  return [explainBookingFlow, listJourneysBetweenDates];
}
