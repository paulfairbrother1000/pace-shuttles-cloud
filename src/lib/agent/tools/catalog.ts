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
  vehicle_types: {
    id: string;
    name: string;
    description?: string | null;
    icon_url?: string | null;
    capacity?: number | null;
    features?: string[] | null;
  }[];
};

const lc = (s?: string | null) => (s ?? "").toLowerCase().trim();

/* ─────────────────────────────────────────────
   Fetch the public visible catalog (SSOT)
   ───────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────
   Operating countries (from routes)
   ───────────────────────────────────────────── */
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

  // Fallback to explicit countries if routes were somehow empty
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

/* ─────────────────────────────────────────────
   Destinations per country (from routes)
   ───────────────────────────────────────────── */
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

function getAllDestinationsGrouped(cat: VisibleCatalog): { country: string; destinations: string[] }[] {
  const countries = getOperatingCountries(cat);
  const out: { country: string; destinations: string[] }[] = [];

  for (const c of countries) {
    const dests = getDestinationsByCountry(cat, c);
    if (dests.length) {
      out.push({ country: c, destinations: dests });
    }
  }
  return out;
}

/* ─────────────────────────────────────────────
   Vehicle / transport types
   ───────────────────────────────────────────── */
function getVisibleVehicleTypes(cat: VisibleCatalog): string[] {
  // Preferred: explicit vehicle_types from transport_types / vehicle_types tables
  if (cat.vehicle_types && cat.vehicle_types.length) {
    const names = Array.from(
      new Set(
        cat.vehicle_types
          .map(v => (v.name || "").trim())
          .filter(Boolean)
      )
    );
    names.sort((a, b) => a.localeCompare(b));
    return names;
  }

  // Fallback: names attached to routes (e.g. “Silver Lady”, “Barbados Boat”)
  const fromRoutes = Array.from(
    new Set(
      (cat.routes || [])
        .map(r => (r.vehicle_type_name || "").trim())
        .filter(Boolean)
    )
  );
  fromRoutes.sort((a, b) => a.localeCompare(b));
  return fromRoutes;
}

/* ─────────────────────────────────────────────
   Tools for catalog / where-we-operate questions
   ───────────────────────────────────────────── */
export function catalogTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  return [
    // 1) Countries we operate in
    {
      spec: {
        type: "function",
        function: {
          name: "list_operating_countries",
          description:
            "List the countries where Pace Shuttles currently has visible, bookable routes. Use this when the user asks things like “what countries do you operate in?”",
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

    // 2) Destinations in a specific country
    {
      spec: {
        type: "function",
        function: {
          name: "list_destinations_in_country",
          description:
            "Given a specific country name (e.g. 'Antigua and Barbuda'), list the destinations Pace Shuttles currently visits there, based on visible routes. ONLY use this when the user explicitly names a country (e.g. “in Antigua”, “in Barbados”). Do NOT use it when the user asks generally about destinations without naming a country.",
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
    },

    // 3) Global destinations across all operating countries
    {
      spec: {
        type: "function",
        function: {
          name: "list_destinations_global",
          description:
            "List all destinations Pace Shuttles currently visits, grouped by country, based on visible routes. Use this when the user asks questions like “what destinations do you visit?”, “where do you go?”, or “and globally?” without specifying a single country.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      },
      async run(): Promise<ToolExecutionResult> {
        const cat = await fetchCatalog(baseUrl);
        const grouped = getAllDestinationsGrouped(cat);

        if (!grouped.length) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "We don’t currently have any bookable destinations listed. Please check back soon as we roll out our first routes."
              }
            ]
          };
        }

        const lines = grouped.map(g => {
          const dests = g.destinations.map(d => `• ${d}`).join(" ");
          return `${g.country}: ${dests}`;
        });

        return {
          messages: [
            {
              role: "assistant",
              content:
                "Here are the destinations we currently visit:\n\n" +
                lines.join("\n")
            }
          ]
        };
      }
    },

    // 4) Global transport / vehicle types
    {
      spec: {
        type: "function",
        function: {
          name: "list_transport_types_global",
          description:
            "List the transport / vehicle types Pace Shuttles currently uses, based on the visible catalog. Use this when the user asks things like “what types of vehicles do you have?”, “what types of boats do you use?”, or “what kinds of transport do you operate?”.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      },
      async run(): Promise<ToolExecutionResult> {
        const cat = await fetchCatalog(baseUrl);
        const types = getVisibleVehicleTypes(cat);

        if (!types.length) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "We don’t currently have any transport types listed in the catalog yet."
              }
            ]
          };
        }

        const bullets = types.map(t => `• ${t}`).join(" ");

        return {
          messages: [
            {
              role: "assistant",
              content: `We currently operate with the following types of transport: ${bullets}`
            }
          ]
        };
      }
    }
  ];
}
