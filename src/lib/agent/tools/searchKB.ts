// src/lib/agent/tools/searchKB.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/**
 * Brand overview – locked-in, non-waffly spiel.
 */
const PACE_SHUTTLES_OVERVIEW =
  "Pace Shuttles is a per-seat, semi-private shuttle service linking marinas, hotels and beach clubs across premium coastal and island destinations. Instead of chartering a whole boat or vehicle, guests simply book individual seats on scheduled departures — giving a private-charter feel at a shared price. Routes, pricing and service quality are managed by Pace Shuttles, while trusted local operators run the journeys. This ensures a smooth, reliable, luxury transfer experience every time.";

/* -------------------------------------------------------------------------- */
/*  Helpers for destination descriptions                                      */
/* -------------------------------------------------------------------------- */

type JourneyRow = {
  starts_at: string;
  pickup_name: string | null;
  destination_name: string | null;
  country_name: string | null;
  route_name?: string | null;
};

/**
 * Build a description string from journeys that touch a given destination.
 */
function describeFromJourneys(
  nameSearch: string,
  rows: JourneyRow[]
): string | null {
  const term = nameSearch.toLowerCase();

  const matching: JourneyRow[] = rows.filter((r) => {
    const p = String(r.pickup_name || "").toLowerCase();
    const d = String(r.destination_name || "").toLowerCase();
    return p.includes(term) || d.includes(term);
  });

  if (!matching.length) return null;

  const names = new Set<string>();
  const counterparts = new Set<string>();
  const countries = new Set<string>();

  for (const r of matching) {
    const p = r.pickup_name;
    const d = r.destination_name;

    if (p && p.toLowerCase().includes(term)) {
      names.add(p);
      if (d) counterparts.add(d);
    }
    if (d && d.toLowerCase().includes(term)) {
      names.add(d);
      if (p) counterparts.add(p);
    }
    if (r.country_name) countries.add(r.country_name);
  }

  const [primaryName] = Array.from(names);
  const alsoCalled = Array.from(names).filter((n) => n !== primaryName);
  const countryList = Array.from(countries);
  const counterpartList = Array.from(counterparts);

  const parts: string[] = [];

  parts.push(
    `${primaryName} is one of the destinations served by Pace Shuttles${
      countryList.length ? ` in ${countryList.join(", ")}` : ""
    }.`
  );

  if (alsoCalled.length) {
    parts.push(
      `In our system it may also appear as: ${alsoCalled.join(" • ")}.`
    );
  }

  if (counterpartList.length) {
    const examples = counterpartList.slice(0, 3).join(" • ");
    parts.push(
      `It’s used as a pickup or drop-off point on routes linking it with places such as ${examples}.`
    );
  }

  parts.push(
    "If you’d like, I can also show you live shuttle journeys serving this destination on specific dates."
  );

  return parts.join(" ");
}

/**
 * Optionally enrich a destination description from a separate destinations table,
 * if you have one. This is additive and safe to ignore if the table/columns don’t exist.
 */
async function maybeEnrichFromDestinationsTable(
  supabase: ToolContext["supabase"],
  nameSearch: string
): Promise<string | null> {
  const term = nameSearch.trim();
  if (!term) return null;

  try {
    const { data, error } = await supabase
      .from("destinations")
      .select("*")
      .ilike("name", `%${term}%`)
      .limit(1);

    if (error || !data || !data.length) return null;

    const row: any = data[0];

    const desc =
      row.description || row.long_description || row.summary || null;
    const website =
      row.website || row.website_url || row.url || row.booking_url || null;

    if (!desc && !website) return null;

    const bits: string[] = [];
    if (desc) bits.push(String(desc));
    if (website) {
      bits.push(`You can read more on the destination’s own site: ${website}.`);
    }

    return bits.join(" ");
  } catch (e) {
    console.warn("destinations table enrichment failed:", e);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  Tool definition                                                            */
/* -------------------------------------------------------------------------- */

export function kbTools(ctx: ToolContext): ToolDefinition[] {
  const { supabase } = ctx;

  const answerFromKB: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "answerFromKB",
        description:
          "Answer conceptual questions about Pace Shuttles itself or about destinations we serve (e.g. Boom, Loose Canon, Shirley Heights, The Cliff). For destinations, use the same live journeys catalog (ps_public_journeys_fn) that powers availability, so new stops are picked up automatically.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description:
                "Short summary of what the user is asking, e.g. 'pace shuttles overview' or 'tell me about Boom in Antigua'.",
            },
            destinationName: {
              type: "string",
              description:
                "If the user is asking about a specific destination, pickup or drop-off point, put the best-guess name here (e.g. 'Boom', 'Loose Canon', 'Shirley Heights', 'The Cliff').",
            },
          },
          required: ["topic"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const topicRaw = String(args.topic || "").trim();
      const topic = topicRaw.toLowerCase();
      const destName =
        typeof args.destinationName === "string"
          ? args.destinationName.trim()
          : "";

      // 1) Brand overview
      if (topic.includes("pace shuttles")) {
        return {
          messages: [
            {
              role: "assistant",
              content: PACE_SHUTTLES_OVERVIEW,
            },
          ],
        };
      }

      // 2) Destination path – always driven from ps_public_journeys_fn
      const searchTerm = destName || topicRaw;
      if (searchTerm) {
        try {
          const { data, error } = await supabase.rpc("ps_public_journeys_fn");

          if (error || !data) {
            console.error("ps_public_journeys_fn error:", error);
            return {
              messages: [
                {
                  role: "assistant",
                  content:
                    "I tried to look that destination up in our live catalog but ran into a system error. Please try again in a moment.",
                },
              ],
            };
          }

          const journeys = data as JourneyRow[];

          const fromJourneys = describeFromJourneys(searchTerm, journeys);
          if (!fromJourneys) {
            return {
              messages: [
                {
                  role: "assistant",
                  content:
                    `${searchTerm} doesn’t appear as a live pickup or destination in our current schedule. It might be inactive right now or stored under a slightly different name. If you tell me the country or nearby area, I can try again or suggest similar stops we do serve.`,
                },
              ],
            };
          }

          // Optional enrichment from a dedicated destinations table, if present
          const extra = await maybeEnrichFromDestinationsTable(
            supabase,
            searchTerm
          );

          const content = extra
            ? `${fromJourneys} ${extra}`
            : fromJourneys;

          return {
            messages: [{ role: "assistant", content }],
          };
        } catch (e) {
          console.error("answerFromKB unexpected error:", e);
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "Something went wrong while I was checking our destinations. Please try again in a moment.",
              },
            ],
          };
        }
      }

      // 3) Fallback – should be rare
      return {
        messages: [
          {
            role: "assistant",
            content:
              "I’m not sure I recognise that yet, but I can still help you explore routes, dates or availability if you tell me where and when you’d like to travel.",
          },
        ],
      };
    },
  };

  return [answerFromKB];
}
