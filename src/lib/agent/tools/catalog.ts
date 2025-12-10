// src/lib/agent/tools/catalog.ts
import type { ToolContext, ToolDefinition, ToolExecutionResult } from "./index";

type VisibleRoute = {
  route_id: string;
  route_name: string;
  country_name: string | null;
  destination_name: string | null;
  pickup_name: string | null;
  vehicle_type_name: string | null;
};

type VisibleCatalog = {
  ok: boolean;
  fallback?: boolean;
  routes: VisibleRoute[];
  countries: { name: string }[];
  destinations: { name: string; country_name?: string | null }[];
  pickups: { name: string; country_name?: string | null }[];
  vehicle_types: { name: string }[];
};

const lc = (s?: string | null) => (s ?? "").toLowerCase().trim();

/**
 * Fetch the public visible catalog (SSOT for what we show on the homepage).
 */
async function fetchCatalog(baseUrl: string): Promise<VisibleCatalog> {
  const res = await fetch(`${baseUrl}/api/public/visible-catalog`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `visible-catalog failed: HTTP ${res.status} ${txt.slice(0, 200)}`
    );
  }

  const json = (await res.json()) as VisibleCatalog;
  if (!json.ok) {
    throw new Error("visible-catalog responded with ok=false");
  }
  return json;
}

/**
 * Build an ordered, unique list of operating countries from the routes.
 */
function getOperatingCountries(cat: VisibleCatalog): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const r of cat.routes || []) {
    const name = (r.country_name || "").trim();
    if (!name) continue;
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }

  // If for some reason routes are empty, fall back to countries array.
  if (!out.length && cat.countries?.length) {
    for (const c of cat.countries) {
      const name = (c.name || "").trim();
      if (!name) continue;
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
    }
  }

  return out;
}

/**
 * Destinations we actually operate in, per country, derived from routes.
 */
function getDestinationsByCountry(cat: VisibleCatalog, countryName: string) {
  const target = lc(countryName);
  if (!target) return [];

  const destNames = new Set<string>();

  for (const r of cat.routes || []) {
    if (!lc(r.country_name) || lc(r.country_name) !== target) continue;
    const dn = (r.destination_name || "").trim();
    if (!dn) continue;
    destNames.add(dn);
  }

  return Array.from(destNames.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * Tools for catalog / where-we-operate questions.
 */
export function catalogTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  return [
    {
      spec: {
        type: "function",
        function: {
          name: "list_operating_countries",
          description:
            "List the countries where Pace Shuttles currently has visible, bookable routes.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      },
      async run(): Promise<ToolExecutionResult> {
        const cat = await fetchCatalog(baseUrl);
        const countries = getOperatingCountries(cat);

        if (!countries.length) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "We don’t have any live, bookable journeys listed right now. Please check back soon as we roll out our first routes."
              }
            ]
          };
        }

        const bullets = countries.map(c => `• ${c}`).join(" ");
        return {
          messages: [
            {
              role: "assistant",
              content: `We currently operate in: ${bullets}`
            }
          ]
        };
      }
    },
    {
      spec: {
        type: "function",
        function: {
          name: "list_destinations_in_country",
          description:
            "Given a country name (e.g. 'Antigua and Barbuda'), list the destinations Pace Shuttles currently visits there, based on visible routes.",
          parameters: {
            type: "object",
            properties: {
              country_name: {
                type: "string",
                description: "The country name, e.g. 'Antigua and Barbuda'."
              }
            },
            required: ["country_name"],
            additionalProperties: false
          }
        }
      },
      async run(args: { country_name: string }): Promise<ToolExecutionResult> {
        const countryName = (args.country_name || "").trim();
        if (!countryName) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "I need the country name to list destinations, for example: “Antigua and Barbuda” or “Barbados”."
              }
            ]
          };
        }

        const cat = await fetchCatalog(baseUrl);
        const countries = getOperatingCountries(cat);
        const targetLC = lc(countryName);

        const matched = countries.find(c => lc(c) === targetLC);
        if (!matched) {
          return {
            messages: [
              {
                role: "assistant",
                content: `I don’t currently have any bookable routes listed in ${countryName}.`
              }
            ]
          };
        }

        const dests = getDestinationsByCountry(cat, matched);

        if (!dests.length) {
          return {
            messages: [
              {
                role: "assistant",
                content: `We don’t currently have any bookable destinations listed in ${matched}.`
              }
            ]
          };
        }

        const bullets = dests.map(d => `• ${d}`).join(" ");
        return {
          messages: [
            {
              role: "assistant",
              content: `In ${matched}, we currently visit: ${bullets}`
            }
          ]
        };
      }
    }
  ];
}
