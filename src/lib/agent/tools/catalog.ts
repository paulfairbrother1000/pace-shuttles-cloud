// src/lib/agent/tools/catalog.ts
import type { SupabaseClient } from "@supabase/supabase-js";

/** Shape of the public visible catalog endpoint */
type VisibleCatalog = {
  routes: {
    route_id?: string;
    route_name?: string;
    country_id?: string | null;
    country_name?: string | null;
    destination_id?: string | null;
    destination_name?: string | null;
    pickup_id?: string | null;
    pickup_name?: string | null;
    vehicle_type_id?: string | null;
    vehicle_type_name?: string | null;
  }[];
  countries: { id?: string; name: string }[];
  destinations: { name: string; country_name?: string | null }[];
  pickups: { name: string; country_name?: string | null }[];
  vehicle_types: { id: string; name: string }[];
};

export type ToolExecutionResult = {
  messages?: { role: "assistant"; content: string }[];
  choices?: any[];
};

export type ToolContext = {
  baseUrl: string;
  supabase: SupabaseClient;
};

export type ToolDefinition = {
  spec: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  };
  run: (args: any, ctx: ToolContext) => Promise<ToolExecutionResult>;
};

async function fetchVisibleCatalog(ctx: ToolContext): Promise<VisibleCatalog> {
  const res = await fetch(`${ctx.baseUrl}/api/public/visible-catalog`, {
    cache: "no-store",
    headers: { Accept: "application/json" }
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `visible-catalog failed: ${res.status} ${txt.slice(0, 200)}`
    );
  }

  return (await res.json()) as VisibleCatalog;
}

/**
 * Catalog-related tools:
 * - list_operating_countries
 * - list_destinations_in_country
 */
export function catalogTools(_ctx: ToolContext): ToolDefinition[] {
  return [
    {
      spec: {
        type: "function",
        function: {
          name: "list_operating_countries",
          description:
            "List the countries where Pace Shuttles currently has visible, bookable routes (operating countries).",
          parameters: {
            type: "object",
            properties: {},
            additionalProperties: false
          }
        }
      },
      async run(_args, ctx): Promise<ToolExecutionResult> {
        const cat = await fetchVisibleCatalog(ctx);

        // Use the countries array from the catalog (already filtered to visible ones)
        const names = Array.from(
          new Set(
            (cat.countries || [])
              .map(c => (c?.name || "").trim())
              .filter(Boolean)
          )
        );

        if (!names.length) {
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

        const list = names.map(n => `• ${n}`).join("\n");

        return {
          messages: [
            {
              role: "assistant",
              content: `We currently operate in:\n\n${list}`
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
            "Given a country name, list the visible destinations Pace Shuttles currently serves there (based on the public catalog).",
          parameters: {
            type: "object",
            properties: {
              country: {
                type: "string",
                description: "Name of the country, e.g. 'Antigua & Barbuda'."
              }
            },
            required: ["country"],
            additionalProperties: false
          }
        }
      },
      async run(args, ctx): Promise<ToolExecutionResult> {
        const countryName = String(args.country || "").trim();
        if (!countryName) {
          return {
            messages: [
              {
                role: "assistant",
                content: "Please tell me which country you’re interested in."
              }
            ]
          };
        }

        const cat = await fetchVisibleCatalog(ctx);
        const target = countryName.toLowerCase();

        // Prefer destinations that actually appear on visible routes
        const routeDestNames = (cat.routes || [])
          .filter(
            r => (r.country_name || "").toLowerCase() === target
          )
          .map(r => (r.destination_name || "").trim())
          .filter(Boolean);

        let destNames: string[];

        if (routeDestNames.length) {
          destNames = Array.from(new Set(routeDestNames));
        } else {
          // Fallback: all destinations tagged with that country
          destNames = Array.from(
            new Set(
              (cat.destinations || [])
                .filter(
                  d => (d.country_name || "").toLowerCase() === target
                )
                .map(d => (d.name || "").trim())
                .filter(Boolean)
            )
          );
        }

        if (!destNames.length) {
          return {
            messages: [
              {
                role: "assistant",
                content: `We don’t currently have any bookable destinations listed in ${countryName}.`
              }
            ]
          };
        }

        const list = destNames.map(n => `• ${n}`).join("\n");

        return {
          messages: [
            {
              role: "assistant",
              content: `In ${countryName}, we currently visit:\n\n${list}`
            }
          ]
        };
      }
    }
  ];
}
