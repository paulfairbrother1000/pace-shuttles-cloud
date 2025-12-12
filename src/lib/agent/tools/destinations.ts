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
  const nameInQuery = rows.find((r) => qNorm.includes(normalise(r.name)));
  if (nameInQuery) return nameInQuery;

  // 3) destination name contains the query
  const queryInName = rows.find((r) => normalise(r.name).includes(qNorm));
  if (queryInName) return queryInName;

  return null;
}

function buildAddress(row: DestinationRow): string {
  return [
    row.address1,
    row.address2,
    row.town,
    row.region,
    row.postal_code,
  ]
    .filter(Boolean)
    .join(", ");
}

function looksTooThin(desc: string | null): boolean {
  const d = (desc ?? "").trim();
  // "Nobu Barbuda offers..." etc can be short; treat under ~140 chars as "thin"
  return d.length < 140;
}

/**
 * Optional enrichment: fetch destination website and extract title + meta description.
 * This is deliberately conservative: quick timeout, no heavy parsing, no guarantees.
 */
async function tryEnrichFromWebsite(
  url: string
): Promise<{ title?: string; summary?: string } | null> {
  const clean = (url || "").trim();
  if (!clean) return null;

  // Avoid SSRF weirdness: only allow http(s)
  if (!/^https?:\/\//i.test(clean)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);

  try {
    const res = await fetch(clean, {
      cache: "no-store",
      signal: ctrl.signal,
      headers: { Accept: "text/html,*/*" },
    });

    if (!res.ok) return null;

    const html = await res.text();
    if (!html || html.length < 200) return null;

    const title =
      html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)?.[1]?.trim() ?? "";

    // Prefer OG description, then meta description
    const ogDesc =
      html
        .match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,400})["']/i)
        ?. [1]?.trim() ?? "";

    const metaDesc =
      html
        .match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,400})["']/i)
        ?. [1]?.trim() ?? "";

    const summary = (ogDesc || metaDesc || "").replace(/\s+/g, " ").trim();

    if (!title && !summary) return null;

    return { title: title || undefined, summary: summary || undefined };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildDestinationDescription(
  row: DestinationRow,
  enriched?: { title?: string; summary?: string } | null
): string {
  const lines: string[] = [];

  const country = row.country_name || "our operating regions";
  lines.push(`**${row.name}** (${country})`);

  // Prefer DB description. If it's thin and we have a good website summary, use that too.
  const dbDesc = (row.description ?? "").trim();
  const webSummary = (enriched?.summary ?? "").trim();

  if (dbDesc) {
    lines.push(dbDesc);
    if (looksTooThin(dbDesc) && webSummary && webSummary !== dbDesc) {
      lines.push(webSummary);
    }
  } else if (webSummary) {
    lines.push(webSummary);
  } else {
    lines.push(
      "We haven’t added a full description for this destination yet, but it’s available as a pickup and/or drop-off point on selected routes."
    );
  }

  const address = buildAddress(row);
  if (address) lines.push(`Address: ${address}`);
  if (row.phone) lines.push(`Phone: ${row.phone}`);
  if (row.website_url) lines.push(`Website: ${row.website_url}`);
  if (row.directions_url) lines.push(`Directions: ${row.directions_url}`);

  // Keep the call-to-action short and on-topic
  lines.push(
    `If you want, say “show journeys to ${row.name}” and I’ll list upcoming departures.`
  );

  return lines.join("\n");
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
          "Look up and describe a specific pickup or destination served by Pace Shuttles using the destinations catalogue (DB-driven). Use this when the user asks things like 'tell me about Boom', 'what is Loose Canon?', 'where is Shirley Heights?', or 'tell me about The Cliff in Barbados'.",
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
              content: `I couldn’t find “${raw}” in the current destinations catalogue. It might not be active yet, or it may be listed under a slightly different name. Try the exact name you see on the site, or ask “where do you go?” to see the full list.`,
            },
          ],
        };
      }

      // Optional: enrich from the destination website if the DB description is thin
      const enriched =
        match.website_url && looksTooThin(match.description)
          ? await tryEnrichFromWebsite(match.website_url)
          : null;

      const content = buildDestinationDescription(match, enriched);

      return { messages: [{ role: "assistant", content }] };
    },
  };

  return [describeDestination];
}
