// src/lib/agent/tools/transport.ts
import type { ToolContext, ToolDefinition, ToolExecutionResult } from "./index";

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function norm(s: string) {
  return (s || "").trim();
}

/* -------------------------------------------------------------------------- */
/*  Tools                                                                     */
/* -------------------------------------------------------------------------- */

export function transportTools(ctx: ToolContext): ToolDefinition[] {
  const { supabase } = ctx;

  /* 0) Locked-in Pace Shuttles overview (tool output is the source of truth) */
  const explainPaceShuttlesOverview: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "explainPaceShuttlesOverview",
        description:
          "Return the official short overview of what Pace Shuttles is and the USP. Use this for questions like 'tell me about Pace Shuttles' or 'what is Pace Shuttles?'.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const content =
        "Pace Shuttles is a per-seat, semi-private shuttle service linking marinas, hotels and beach clubs across premium coastal and island destinations. Instead of chartering a whole boat or vehicle, guests simply book individual seats on scheduled departures — giving a private-charter feel at a shared price. Routes, pricing and service quality are managed by Pace Shuttles, while trusted local operators run the journeys. This ensures a smooth, reliable, luxury transfer experience every time.";
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 1) List transport types (NEVER vehicle/vessel names) */
  const listTransportTypes: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listTransportTypes",
        description:
          "List the high-level transport types available (e.g. Speed Boat, Helicopter, Bus). Never return vessel or operator names.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const { data, error } = await supabase
        .from("transport_types")
        .select("name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Sorry — I couldn’t load transport types right now.",
            },
          ],
        };
      }

      const names = (data ?? [])
        .map((r: any) => r?.name)
        .filter(Boolean);

      if (!names.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I don’t have any transport types configured yet.",
            },
          ],
        };
      }

      return {
        messages: [
          {
            role: "assistant",
            content: `We currently offer: ${names.join(", ")}.`,
          },
        ],
      };
    },
  };

  /* 2) Which countries have a given transport type (routes-driven) */
  const countriesByTransportType: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "countriesByTransportType",
        description:
          "Given a transport type (e.g. Helicopter, Bus, Speed Boat), return which countries have active routes using that transport type.",
        parameters: {
          type: "object",
          properties: {
            transportType: {
              type: "string",
              description: "Transport type name, e.g. 'Helicopter' or 'Bus'.",
            },
          },
          required: ["transportType"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const transportType = norm(args.transportType);
      if (!transportType) {
        return {
          messages: [
            {
              role: "assistant",
              content: "Which transport type should I check?",
            },
          ],
        };
      }

      const { data, error } = await supabase
        .from("routes")
        .select("country:countries(name)")
        .eq("is_active", true)
        .ilike("transport_type", transportType);

      if (error) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Sorry — I couldn’t look up countries for that transport type right now.",
            },
          ],
        };
      }

      const names = new Set<string>();
      (data ?? []).forEach((r: any) => {
        const n = r?.country?.name;
        if (n) names.add(n);
      });

      const list = [...names].sort((a, b) => a.localeCompare(b));

      if (!list.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I can’t see any active ${transportType} routes at the moment.`,
            },
          ],
        };
      }

      return {
        messages: [
          {
            role: "assistant",
            content: `Countries with active ${transportType} services: ${list.join(", ")}.`,
          },
        ],
      };
    },
  };

  /* 3) Routes by transport type (optionally filtered) */
  const routesByTransportType: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "routesByTransportType",
        description:
          "List routes for a given transport type, optionally filtered by country and/or destination. Uses routes.transport_type and joins to pickup/destination names.",
        parameters: {
          type: "object",
          properties: {
            transportType: {
              type: "string",
              description: "Transport type name, e.g. 'Bus', 'Helicopter', 'Speed Boat'.",
            },
            country: {
              type: "string",
              description: "Optional country name filter, e.g. 'Antigua and Barbuda' or 'Barbados'.",
            },
            destination: {
              type: "string",
              description: "Optional destination name filter, e.g. 'Shirley Heights'.",
            },
          },
          required: ["transportType"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const transportType = norm(args.transportType);
      const country = norm(args.country);
      const destination = norm(args.destination);

      if (!transportType) {
        return {
          messages: [{ role: "assistant", content: "Which transport type should I list routes for?" }],
        };
      }

      // Base query
      let q = supabase
        .from("routes")
        .select(
          `
          route_name,
          transport_type,
          country:countries(name),
          pickup:pickups(name),
          destination:destinations(name)
        `
        )
        .eq("is_active", true)
        .ilike("transport_type", transportType);

      // Country filter (join filter via countries.name requires a second pass; simplest is client-side filter)
      const { data, error } = await q;

      if (error) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Sorry — I couldn’t look up routes for that transport type right now.",
            },
          ],
        };
      }

      const rows = (data ?? []).filter((r: any) => {
        const c = r?.country?.name || "";
        const d = r?.destination?.name || "";
        if (country && c.toLowerCase() !== country.toLowerCase()) return false;
        if (destination && d.toLowerCase() !== destination.toLowerCase()) return false;
        return true;
      });

      if (!rows.length) {
        const cMsg = country ? ` in ${country}` : "";
        const dMsg = destination ? ` to ${destination}` : "";
        return {
          messages: [
            {
              role: "assistant",
              content: `I can’t see any active ${transportType} routes${cMsg}${dMsg} at the moment.`,
            },
          ],
        };
      }

      const lines = rows
        .map((r: any) => {
          const pick = r?.pickup?.name ?? "Pickup";
          const dest = r?.destination?.name ?? "Destination";
          const c = r?.country?.name ?? "";
          return `• ${pick} → ${dest}${c ? ` (${c})` : ""}`;
        })
        .sort((a: string, b: string) => a.localeCompare(b));

      return {
        messages: [
          {
            role: "assistant",
            content: `Here are the active ${transportType} routes${country ? ` in ${country}` : ""}${destination ? ` to ${destination}` : ""}:\n${lines.join("\n")}`,
          },
        ],
      };
    },
  };

  return [
    explainPaceShuttlesOverview,
    listTransportTypes,
    countriesByTransportType,
    routesByTransportType,
  ];
}
