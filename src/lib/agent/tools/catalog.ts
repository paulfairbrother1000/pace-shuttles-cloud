// src/lib/agent/tools/catalog.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

/* -------------------------------------------------------------------------- */
/*  Types mirroring /api/public/visible-catalog                               */
/* -------------------------------------------------------------------------- */

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

type VisibleCatalog = {
  ok: boolean;
  fallback?: boolean;
  routes: VisibleRoute[];
  countries: any[];
  destinations: any[];
  pickups: any[];
  vehicle_types: any[];
};

type VehicleType = {
  id: string;
  name: string;
  description?: string | null;
};

type VehicleTypesResponse = {
  rows?: VehicleType[];
};

/* -------------------------------------------------------------------------- */

const lc = (s?: string | null) => (s ?? "").toLowerCase().trim();

function normaliseCountryName(name: string | null | undefined): string {
  if (!name) return "";
  return lc(name).replace(/&/g, "and").replace(/\s+/g, " ");
}

function unique(values: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const trimmed = v.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadVisibleCatalog(
  baseUrl: string
): Promise<VisibleCatalog | null> {
  return fetchJSON<VisibleCatalog>(`${baseUrl}/api/public/visible-catalog`);
}

async function loadVehicleTypes(baseUrl: string): Promise<VehicleType[]> {
  const data = await fetchJSON<VehicleTypesResponse>(
    `${baseUrl}/api/public/vehicle-types`
  );
  if (!data || !Array.isArray(data.rows)) return [];
  return data.rows;
}

/* -------------------------------------------------------------------------- */
/*  Catalog tool implementations                                              */
/* -------------------------------------------------------------------------- */

export function catalogTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* 1) Countries where we operate */
  const listOperatingCountries: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listOperatingCountries",
        description:
          "List the countries where Pace Shuttles currently has live, bookable routes according to the public catalog.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const cat = await loadVisibleCatalog(baseUrl);
      if (!cat || !cat.routes?.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "We don’t currently have any live, bookable journeys listed right now. Please check back soon as we roll out our first routes.",
            },
          ],
        };
      }

      const countries = unique(cat.routes.map((r) => r.country_name));
      const content =
        countries.length > 0
          ? `We currently operate in:\n• ${countries.join(" • ")}`
          : "We don’t currently have any live, bookable journeys listed right now. Please check back soon.";

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 2) Destinations we visit within a given country */
  const listDestinationsInCountry: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listDestinationsInCountry",
        description:
          "Given a country name, list the destinations Pace Shuttles currently visits in that country (beach clubs, restaurants, islands, bays, etc.) based ONLY on the public catalog.",
        parameters: {
          type: "object",
          properties: {
            country: {
              type: "string",
              description:
                "Country name from the user question, e.g. 'Antigua and Barbuda' or 'Barbados'.",
            },
          },
          required: ["country"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const countryRaw = String(args.country || "");
      const normQuery = normaliseCountryName(countryRaw);
      const cat = await loadVisibleCatalog(baseUrl);

      if (!cat || !cat.routes?.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t find any live destinations right now. Please check back soon as routes go live.",
            },
          ],
        };
      }

      const inCountry = cat.routes.filter(
        (r) => normaliseCountryName(r.country_name) === normQuery
      );

      if (!inCountry.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live routes in ${countryRaw} yet.`,
            },
          ],
        };
      }

      const dests = unique(inCountry.map((r) => r.destination_name));
      const prettyCountry = inCountry[0].country_name || countryRaw;

      if (!dests.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `We don’t currently have any bookable destinations listed in ${prettyCountry}.`,
            },
          ],
        };
      }

      const content = `In ${prettyCountry}, we currently visit:\n• ${dests.join(
        " • "
      )}`;

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 3) Pickup / boarding points in a given country */
  const listPickupsInCountry: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listPickupsInCountry",
        description:
          "Given a country name, list the pickup / boarding locations for journeys in that country (e.g. marinas, harbours, heliports). Use this when the user asks where journeys begin or where they get on the transport.",
        parameters: {
          type: "object",
          properties: {
            country: {
              type: "string",
              description:
                "Country name from the user question, e.g. 'Antigua and Barbuda' or 'Barbados'.",
            },
          },
          required: ["country"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const countryRaw = String(args.country || "");
      const normQuery = normaliseCountryName(countryRaw);
      const cat = await loadVisibleCatalog(baseUrl);

      if (!cat || !cat.routes?.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t find any live pickup locations yet. Please check back soon as routes go live.",
            },
          ],
        };
      }

      const inCountry = cat.routes.filter(
        (r) => normaliseCountryName(r.country_name) === normQuery
      );

      if (!inCountry.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live routes in ${countryRaw} yet.`,
            },
          ],
        };
      }

      const pickups = unique(inCountry.map((r) => r.pickup_name));
      const prettyCountry = inCountry[0].country_name || countryRaw;

      if (!pickups.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `We don’t currently have any pickup locations listed in ${prettyCountry}.`,
            },
          ],
        };
      }

      const content = `In ${prettyCountry}, our current pickup / boarding points include:\n• ${pickups.join(
        " • "
      )}`;

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 4) Routes (pickup → destination) in a given country */
  const listRoutesInCountry: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listRoutesInCountry",
        description:
          "Given a country name, list the shuttle routes in that country as pickup → destination pairs based on the public catalog.",
        parameters: {
          type: "object",
          properties: {
            country: {
              type: "string",
              description:
                "Country name from the user question, e.g. 'Antigua and Barbuda' or 'Barbados'.",
            },
          },
          required: ["country"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const countryRaw = String(args.country || "");
      const normQuery = normaliseCountryName(countryRaw);
      const cat = await loadVisibleCatalog(baseUrl);

      if (!cat || !cat.routes?.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t find any live routes right now. Please check back soon as services go live.",
            },
          ],
        };
      }

      const inCountry = cat.routes.filter(
        (r) => normaliseCountryName(r.country_name) === normQuery
      );

      if (!inCountry.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live routes in ${countryRaw} yet.`,
            },
          ],
        };
      }

      const routes = unique(
        inCountry.map(
          (r) => r.route_name || `${r.pickup_name} → ${r.destination_name}`
        )
      );
      const prettyCountry = inCountry[0].country_name || countryRaw;

      const content = `In ${prettyCountry}, our current routes include:\n• ${routes.join(
        " • "
      )}`;

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 5) High-level transport categories – DB-driven, no vessel names */
  const listTransportTypes: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listTransportTypes",
        description:
          "Describe the generic categories of transport used by Pace Shuttles (e.g. speed boat, helicopter, limo, bus) based on the public vehicle-types catalog. Never reveal specific operator or vessel names.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const types = await loadVehicleTypes(baseUrl);
      const names = unique(types.map((t) => t.name));

      if (!names.length) {
        const fallback =
          "We use premium categories of transport tailored to each route, typically high-end boats and other private transfer options. Specific vessel or operator names are not disclosed in advance of a booking.";
        return { messages: [{ role: "assistant", content: fallback }] };
      }

      const content =
        "We currently use the following categories of transport:\n• " +
        names.join(" • ") +
        "\n\nThe exact mix available depends on the territory and route, but specific vessel or operator names are not disclosed in advance of a booking.";

      return { messages: [{ role: "assistant", content }] };
    },
  };

  return [
    listOperatingCountries,
    listDestinationsInCountry,
    listPickupsInCountry,
    listRoutesInCountry,
    listTransportTypes,
  ];
}
