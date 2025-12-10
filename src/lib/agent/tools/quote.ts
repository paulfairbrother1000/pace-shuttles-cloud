// src/lib/agent/tools/quote.ts
import type { ToolDefinition, ToolContext } from "./index";

export function quoteTools({ baseUrl }: ToolContext): ToolDefinition[] {
  return [
    {
      spec: {
        type: "function",
        function: {
          name: "get_quote",
          description: "Get live quote for given route and date",
          parameters: {
            type: "object",
            properties: {
              route_id: { type: "string" },
              date: { type: "string" },
              qty: { type: "number" }
            },
            required: ["route_id", "date"]
          }
        }
      },
      run: async (args) => {
        const url = new URL(`${baseUrl}/api/quote`);
        url.searchParams.set("route_id", args.route_id);
        url.searchParams.set("date", args.date);
        url.searchParams.set("qty", String(args.qty || 1));

        const res = await fetch(url, { cache: "no-store" });
        const out = (await res.json()) || {};

        if (!out.availability || out.availability !== "available") {
          return {
            messages: [
              {
                role: "assistant",
                content: "That option isn’t available. Try a different date."
              }
            ]
          };
        }

        return {
          messages: [
            {
              role: "assistant",
              content: `From £${Math.ceil(out.unit_cents / 100)}`
            }
          ]
        };
      }
    }
  ];
}
