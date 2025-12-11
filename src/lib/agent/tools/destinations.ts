// src/lib/agent/tools/destinations.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

type DestinationRow = {
  name: string;
  country_name: string | null;
  description: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  phone: string | null;
  website_url: string | null;
  image_url: string | null;
  directions_url: string | null;
  active: boolean;
};

type DestinationsResponse = {
  ok: boolean;
  rows: DestinationRow[];
  count: number;
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "") // drop apostrophes
    .replace(/[^a-z0-9]+/g, " ") // collapse punctuation/whitespace
    .trim();
}

async function fetchDestinations(baseUrl: string): Promise<DestinationRow[]> {
  try {
    const res = await fetch(`${baseUrl}/api/public/destinations`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    if (!res.ok) return [];

    const data = (await res.json()) as DestinationsResponse;
    if (!data.ok || !Array.isArray(data.rows)) return [];

    // only keep active destinations
    return data.rows.filter((d) => d.active);
  } catch {
    return [];
  }
}

/**
 * Given a free-text user query (e.g. "the cliff in barbados",
 * "tell me about loose canon"), find the best destination row.
 */
function findBestDestination(
  query: string,
  rows: DestinationRow[]
): DestinationRow | null {
  const qNorm = normalise(query);

  if (!qNorm) return null;

  // 1) exact name match (case-insensitive, ignoring punctuation)
  const exact = rows.find((r) => normalise(r.name) === qNorm);
  if (exact) return exact;

  // 2) query contains the destination name
  const nameInQuery = rows.find((r) =>
    qNorm.includes(normalise(r.name))
  );
  if (nameInQuery) return nameInQuery;

  // 3) destination name contains the query
  const queryInName = rows.find((r) =>
    normalise(r.name).includes(qNorm)
  );
  if (queryInName) return queryInName;

  return null;
}

function buildDestinationDescription(row: DestinationRow): string {
  const parts: string[] = [];

  const country = row.country_name || "one of our operating regions";

  parts.push(
    `${row.name} is one of the destinations served by Pace Shuttles in ${country}.`
  );

  if (row.description && row.description.trim().length > 0) {
    parts.push(row.description.trim());
  }

  const addressBits = [
    row.address1,
    row.address2,
    row.town,
    row.region,
    row.postal_code,
  ]
    .filter(Boolean)
    .join(", ");

  if (addressBits) {
    parts.push(`It’s located at: ${addressBits}.`);
  }

  if (row.website_url) {
    parts.push(
      `You can find out more or make direct reservations on their website: ${row.website_url}.`
    );
  }

  if (row.directions_url) {
    parts.push(
      `For directions, you can use this map link: ${row.directions_url}.`
    );
  }

  parts.push(
    `If you’d like, ask me about journeys to or from ${row.name} on specific dates and I’ll check the live shuttle schedule.`
  );

  return parts.join(" ");
}

/* -------------------------------------------------------------------------- */
/*  Tools                                                                     */
/* -------------------------------------------------------------------------- */

export function destinationsTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  const describeDestination: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "describeDestination",
        description:
          "Look up and describe a specific pickup or destination served by Pace Shuttles. Use this when the user asks things like 'tell me about Boom', 'what is Loose Canon?', 'where is Shirley Heights?', or 'tell me about The Cliff in Barbados'.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "The name or phrase the user used for the pickup/destination, e.g. 'Boom', 'Loose Canon', 'the cliff in Barbados'.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const raw = String(args.name ?? "").trim();

      if (!raw) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Which destination would you like to know about? For example, Boom, Loose Canon, Shirley Heights, Nobu or The Cliff.",
            },
          ],
        };
      }

      const destinations = await fetchDestinations(baseUrl);

      if (!destinations.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t reach the destinations catalogue just now, so I can’t give a detailed description. Please try again in a moment.",
            },
          ],
        };
      }

      const match = findBestDestination(raw, destinations);

      if (!match) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find a destination called “${raw}” in the current Pace Shuttles catalogue. It might not be active yet, or it may be listed under a slightly different name. Try asking with the exact name you see on the schedule, or ask “where do you go?” to see the full list.`,
            },
          ],
        };
      }

      const content = buildDestinationDescription(match);

      return {
        messages: [{ role: "assistant", content }],
      };
    },
  };

  return [describeDestination];
}
