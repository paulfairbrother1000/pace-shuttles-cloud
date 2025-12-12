// src/lib/agent/tools/transportCategories.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/**
 * NOTE: This tool assumes you have a view or table that exposes,
 * at minimum:
 *   - country_name
 *   - pickup_name
 *   - destination_name
 *   - vehicle_category_name  (e.g. "Speed Boat", "Helicopter")
 *   - active (boolean)
 *
 * In the code below it's called "vw_public_route_vehicle_categories".
 * If your actual view has a different name / columns, just update
 * the from(...) call and the select list accordingly.
 */

type RouteVehicleRow = {
  country_name: string | null;
  pickup_name: string | null;
  destination_name: string | null;
  vehicle_category_name: string | null;
  active?: boolean | null;
};

export function transportCategoriesTools(ctx: ToolContext): ToolDefinition[] {
  const { supabase } = ctx;

  const describeVehicleCategoryUsage: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "describeVehicleCategoryUsage",
        description:
          "Answer questions about which countries or routes use a given transport category (e.g. Helicopter, Speed Boat, Bus, Limo). Use this when the user asks things like 'which countries have helicopter services?' or 'what helicopter routes are available in Antigua?'.",
        parameters: {
          type: "object",
          properties: {
            categoryName: {
              type: "string",
              description:
                "The transport category name, such as 'Helicopter', 'Speed Boat', 'Bus' or 'Limo'.",
            },
            countryName: {
              type: "string",
              description:
                "Optional country filter, e.g. 'Antigua and Barbuda' or 'Barbados'. If omitted, the tool will return countries where this category operates.",
            },
          },
          required: ["categoryName"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const rawCategory = String(args.categoryName ?? "").trim();
      const rawCountry = args.countryName
        ? String(args.countryName).trim()
        : "";

      if (!rawCategory) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Which transport category are you interested in? For example: Helicopter, Speed Boat, Bus or Limo.",
            },
          ],
        };
      }

      // Normalise category a bit for ilike search
      const categoryFilter = rawCategory.toLowerCase();

      // Base query – adjust the view / columns here if needed.
      let query = supabase
        .from("vw_public_route_vehicle_categories")
        .select(
          "country_name, pickup_name, destination_name, vehicle_category_name, active"
        )
        .ilike("vehicle_category_name", `%${categoryFilter}%`);

      if (rawCountry) {
        query = query.ilike("country_name", `%${rawCountry}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error("describeVehicleCategoryUsage error:", error);
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I had trouble looking up the transport categories just now. Please try again in a moment.",
            },
          ],
        };
      }

      const rows = (data as RouteVehicleRow[] | null) ?? [];
      const activeRows = rows.filter(
        (r) => r.active === null || r.active === true
      );

      if (!activeRows.length) {
        if (rawCountry) {
          return {
            messages: [
              {
                role: "assistant",
                content: `I couldn’t find any active routes in ${rawCountry} using the ${rawCategory} category yet. It might not be live there, or it may be set up under a slightly different category name.`,
              },
            ],
          };
        }
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any active routes using the ${rawCategory} category yet. It might not be configured in the system, or it may be labelled differently (for example "Helicopter Shuttle" instead of "Helicopter").`,
            },
          ],
        };
      }

      // Group by country
      const byCountry = new Map<
        string,
        { pickups: Set<string>; routes: Set<string> }
      >();

      for (const row of activeRows) {
        const c = row.country_name || "Unknown country";
        const pickup = row.pickup_name || "Pickup";
        const dest = row.destination_name || "Destination";
        const routeLabel = `${pickup} → ${dest}`;

        if (!byCountry.has(c)) {
          byCountry.set(c, {
            pickups: new Set<string>(),
            routes: new Set<string>(),
          });
        }
        const entry = byCountry.get(c)!;
        entry.pickups.add(pickup);
        entry.routes.add(routeLabel);
      }

      // If a specific country was requested, focus on routes there.
      if (rawCountry) {
        // Try to pick the matching key more robustly
        const countryKey =
          Array.from(byCountry.keys()).find((k) =>
            k.toLowerCase().includes(rawCountry.toLowerCase())
          ) || rawCountry;

        const entry = byCountry.get(countryKey);

        if (!entry) {
          return {
            messages: [
              {
                role: "assistant",
                content: `I couldn’t find any active ${rawCategory} routes in ${rawCountry} right now.`,
              },
            ],
          };
        }

        const routesList = Array.from(entry.routes).sort();

        const content =
          `In ${countryKey}, the current ${rawCategory} routes include:\n` +
          routesList.map((r) => `• ${r}`).join("\n") +
          `\n\nYou can ask for specific dates (for example “what ${rawCategory.toLowerCase()} journeys do you have in Antigua in January?”) and I’ll check the live schedule for you.`;

        return {
          messages: [{ role: "assistant", content }],
        };
      }

      // Otherwise, answer “which countries have X”
      const countrySummaries: string[] = [];
      const sortedCountries = Array.from(byCountry.keys()).sort();

      for (const c of sortedCountries) {
        const entry = byCountry.get(c)!;
        const sampleRoutes = Array.from(entry.routes).slice(0, 3);
        const snippet =
          sampleRoutes.length > 0
            ? ` (for example: ${sampleRoutes.join("; ")})`
            : "";
        countrySummaries.push(`• ${c}${snippet}`);
      }

      const content =
        `I can see the ${rawCategory} category operating in the following countries:\n` +
        countrySummaries.join("\n") +
        `\n\nIf you’d like details for a single country, ask something like “what ${rawCategory.toLowerCase()} routes are available in Antigua?”.`;

      return {
        messages: [{ role: "assistant", content }],
      };
    },
  };

  return [describeVehicleCategoryUsage];
}
