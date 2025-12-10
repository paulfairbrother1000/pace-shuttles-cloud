// src/lib/agent/tools/catalog.ts
import type { ToolDefinition, ToolContext, ToolExecutionResult } from "./index";
import type { AgentChoice } from "@/lib/agent/agent-schema";

type VisibleRoute = {
  route_id: string;
  route_name: string;
  country_id: string | null;
  country_name: string | null;
  destination_id: string | null;
  destination_name: string | null;
  pickup_id: string | null;
  pickup_name: string | null;
  vehicle_type_id: string | null;
  vehicle_type_name: string | null;
};

type VisibleCountry = {
  id?: string | null;
  name: string;
  description?: string | null;
};

type VisibleDestination = {
  name: string;
  country_name?: string | null;
};

type VisibleVehicleType = {
  id: string;
  name: string;
  description?: string | null;
};

export type VisibleCatalog = {
  ok: boolean;
  fallback: boolean;
  routes: VisibleRoute[];
  countries: VisibleCountry[];
  destinations: VisibleDestination[];
  pickups: { name: string; country_name?: string | null }[];
  vehicle_types: VisibleVehicleType[];
};

async function fetchCatalog(baseUrl: string): Promise<VisibleCatalog> {
  const res = await fetch(`${baseUrl}/api/public/visible-catalog`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`visible-catalog HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  const json = (await res.json()) as VisibleCatalog;
  return json;
}

function lc(s?: string | null) {
  return (s ?? "").toLowerCase();
}

/* ─────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────── */

function getOperatingCountries(cat: VisibleCatalog): string[] {
  // Any country that appears in visible routes
  const names = new Set<string>();
  for (const r of cat.routes ?? []) {
    if (r.country_name) names.add(r.country_name);
  }
  // Fallback: also include countries table if no routes yet
  if (!names.size && cat.countries?.length) {
    for (const c of cat.countries) names.add(c.name);
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function getDestinationsInCountry(cat: VisibleCatalog, countryName: string): string[] {
  const wanted = lc(countryName);
  const names = new Set<string>();

  // From routes (strongest signal)
  for (const r of cat.routes ?? []) {
    if (lc(r.country_name) === wanted && r.destination_name) {
      names.add(r.destination_name);
    }
  }

  // Fallback: from destinations table
  for (const d of cat.destinations ?? []) {
    if (lc(d.country_name) === wanted && d.name) {
      names.add(d.name);
    }
  }

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function getVisibleVehicleTypes(cat: VisibleCatalog): string[] {
  // HARD GUARDRAIL:
  // Only ever expose generic *type* labels that come from vehicle_types /
  // transport_types. Never expose individual vessel names or operator names.
  if (!cat.vehicle_types || !cat.vehicle_types.length) return [];

  const names = Array.from(
    new Set(
      cat.vehicle_types
        .map((v) => (v.name || "").trim())
        .filter(Boolean)
    )
  );

  names.sort((a, b) => a.localeCompare(b));
  return names;
}

/* ─────────────────────────────────────────────
   Tools for catalog / where-we-operate questions
   ───────────────────────────────────────────── */

export function catalogTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  const tools: ToolDefinition[] = [
    // 1) Operating countries
    {
      spec: {
        type: "function",
        function: {
          name: "list_operating_countries",
          description:
            "List the countries where Pace Shuttles currently has visible routes in the public catalog. Use this when the user asks which countries we operate in.",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
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
                  "We don’t have any live, bookable journeys listed right now. Please check back soon as we roll out our first routes.",
              },
            ],
          };
        }

        const bullets = countries.map((c) => `• ${c}`).join(" ");
        return {
          messages: [
            {
              role: "assistant",
              content: `We currently operate in: ${bullets}`,
            },
          ],
        };
      },
    },

    // 2) Destinations in a given country
    {
      spec: {
        type: "function",
        function: {
          name: "list_destinations_in_country",
          description:
            "List destinations we visit in a specific country, based on the public visible catalog. Use for questions like 'What destinations do you visit in Antigua?'",
          parameters: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description: "Country name, e.g. 'Antigua and Barbuda'.",
              },
            },
            required: ["country"],
            additionalProperties: false,
          },
        },
      },
      async run(args: { country: string }): Promise<ToolExecutionResult> {
        const countryName = (args.country || "").trim();
        if (!countryName) {
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "Please tell me which country you’re interested in, for example: Antigua and Barbuda or Barbados.",
              },
            ],
          };
        }

        const cat = await fetchCatalog(baseUrl);
        const destinations = getDestinationsInCountry(cat, countryName);

        if (!destinations.length) {
          return {
            messages: [
              {
                role: "assistant",
                content: `We don’t currently have any bookable destinations listed in ${countryName}.`,
              },
            ],
          };
        }

        const bullets = destinations.map((d) => `• ${d}`).join(" ");
        return {
          messages: [
            {
              role: "assistant",
              content: `In ${countryName}, we currently visit: ${bullets}`,
            },
          ],
        };
      },
    },

    // 3) Global transport / vehicle types (operator-agnostic)
    {
      spec: {
        type: "function",
        function: {
          name: "list_transport_types_global",
          description:
            "List the generic transport / vehicle TYPES that Pace Shuttles uses (e.g. speed boats, helicopters, shuttle buses). " +
            "Never disclose operator names or individual vessel names. Use this when the user asks things like 'what types of vehicles do you have?'",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
      async run(): Promise<ToolExecutionResult> {
        const cat = await fetchCatalog(baseUrl);
        const types = getVisibleVehicleTypes(cat);

        if (!types.length) {
          // Brand-safe fallback – still operator-agnostic
          return {
            messages: [
              {
                role: "assistant",
                content:
                  "We use a mix of premium transport types tailored to each route, such as modern boats and other high-end vehicles. " +
                  "As we expand, you’ll see more detailed categories shown in the app.",
              },
            ],
          };
        }

        const bullets = types.map((t) => `• ${t}`).join(" ");
        return {
          messages: [
            {
              role: "assistant",
              content: `We currently operate with the following types of transport: ${bullets}`,
            },
          ],
        };
      },
    },
  ];

  return tools;
}
