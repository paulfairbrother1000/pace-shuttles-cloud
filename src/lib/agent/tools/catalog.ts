// src/lib/agent/tools/catalog.ts
import type { ToolDefinition, ToolContext } from "./index";
import { choice } from "@/lib/agent/agent-schema";

async function getCatalog(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/public/visible-catalog`, {
    cache: "no-store",
    headers: { accept: "application/json" }
  });
  if (!res.ok) throw new Error("Catalog fetch failed");
  return res.json();
}

export function catalogTools({ baseUrl }: ToolContext): ToolDefinition[] {
  return [
    {
      spec: {
        type: "function",
        function: {
          name: "list_countries",
          description: "Get current operating countries",
          parameters: { type: "object", properties: {} }
        }
      },
      run: async () => {
        const cat = await getCatalog(baseUrl);
        const countries = cat.countries ?? [];

        return {
          messages: [
            {
              role: "assistant",
              content: `We currently operate in:`
            }
          ],
          choices: countries.map((c: any) =>
            choice(c.name, {
              type: "select_country",
              payload: { country_id: c.id, country_name: c.name }
            })
          )
        };
      }
    },

    {
      spec: {
        type: "function",
        function: {
          name: "list_destinations",
          description: "Get destinations for a country",
          parameters: {
            type: "object",
            properties: {
              country_id: { type: "string" },
              country_name: { type: "string" }
            },
            required: ["country_id"]
          }
        }
      },
      run: async (args) => {
        const { country_id, country_name } = args;
        const cat = await getCatalog(baseUrl);
        const dests = (cat.destinations ?? []).filter(
          (d: any) => d.country_name === country_name
        );

        return {
          messages: [
            {
              role: "assistant",
              content: `Destinations available in ${country_name}:`
            }
          ],
          choices: dests.map((d: any) =>
            choice(d.name, {
              type: "select_destination",
              payload: { destination: d }
            })
          )
        };
      }
    }
  ];
}
