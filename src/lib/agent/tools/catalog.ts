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
  destinations: any[]; // we treat these as 'any' to stay schema-tolerant
  pickups: any[];
  vehicle_types: any[];
};

/* Types for /api/public/vehicle-types ------------------------------------- */

type VehicleTypesResponse = {
  rows?: {
    id: string;
    name: string | null;
    description?: string | null;
  }[];
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

async function loadVisibleCatalog(baseUrl: string): Promise<VisibleCatalog | null> {
  return fetchJSON<VisibleCatalog>(`${baseUrl}/api/public/visible-catalog`);
}

/* -------------------------------------------------------------------------- */
/*  Catalog tool implementations                                              */
/* -------------------------------------------------------------------------- */

export function catalogTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* 1) Countries where we operate ----------------------------------------- */

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

  /* 2) Destinations we visit within a given country ----------------------- */

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

  /* 3) Describe a specific destination by name ---------------------------- */

  const describeDestinationByName: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "describeDestinationByName",
        description:
          "Given the name of a destination (e.g. 'Boom', 'Loose Canon', 'The Cliff'), look it up in the public catalog and describe what/where it is using any stored description, address and country. Use this whenever the user asks things like 'tell me about Boom', 'what is The Cliff?', or 'what is Loose Canon like?'.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "The destination name as asked by the user, e.g. 'Boom', 'Loose Canon', 'The Cliff'.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const rawName = String(args.name || "").trim();
      const query = lc(rawName);
      if (!query) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Tell me the name of the destination you’re interested in, and I’ll describe it.",
            },
          ],
        };
      }

      const cat = await loadVisibleCatalog(baseUrl);
      if (!cat) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t access the destination catalog just now. Please try again in a moment.",
            },
          ],
        };
      }

      const dests = (cat.destinations ?? []) as any[];

      // 1) Try exact name match
      let dest =
        dests.find((d) => lc(d.name) === query) ??
        // 2) Fallback: case-insensitive 'contains' match
        dests.find((d) => lc(d.name).includes(query));

      // 3) As a final fallback, try to infer from routes
      if (!dest && cat.routes?.length) {
        const fromRoutes = cat.routes.find(
          (r) =>
            lc(r.destination_name) === query ||
            lc(r.destination_name).includes(query)
        );
        if (fromRoutes) {
          dest = {
            name: fromRoutes.destination_name,
            country_name: fromRoutes.country_name,
          };
        }
      }

      if (!dest) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find a destination called “${rawName}” in the current catalog. It might not be live yet.`,
            },
          ],
        };
      }

      const name: string = dest.name ?? rawName;
      const country: string | undefined =
        dest.country_name ?? dest.country ?? undefined;

      const description: string | undefined =
        dest.description_long ??
        dest.description ??
        dest.description_short ??
        undefined;

      const line1: string | undefined = dest.address_line1 ?? dest.address1;
      const line2: string | undefined = dest.address_line2 ?? dest.address2;
      const city: string | undefined = dest.city ?? undefined;
      const website: string | undefined = dest.website_url ?? dest.website;

      const parts: string[] = [];

      // Main sentence
      if (description) {
        parts.push(description.trim());
      } else {
        const placeBits: string[] = [];
        placeBits.push(name);
        if (city) placeBits.push(city);
        if (country) placeBits.push(country);
        const label = placeBits.join(", ");

        parts.push(
          `${label} is one of the destinations served by Pace Shuttles. It’s available as a drop-off or pick-up point on selected shuttle routes.`
        );
      }

      // Address
      const addressBits: string[] = [];
      if (line1) addressBits.push(line1);
      if (line2) addressBits.push(line2);
      if (city) addressBits.push(city);
      if (country) addressBits.push(country);

      if (addressBits.length) {
        parts.push(`Address: ${addressBits.join(", ")}.`);
      }

      // Website
      if (website) {
        parts.push(
          `If you’d like to explore the venue itself in more detail, you can also visit their website: ${website}.`
        );
      }

      // Closing hint
      parts.push(
        "If you’d like, I can also show you current shuttle journeys serving this destination on specific dates."
      );

      const content = parts.join(" ");

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 4) Pickup / boarding points in a given country ------------------------ */

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

  /* 5) Routes (pickup → destination) in a given country ------------------- */

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

  /* 6) High-level transport categories – from /api/public/vehicle-types ---- */

  const listTransportTypes: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listTransportTypes",
        description:
          "Describe the generic categories of transport used by Pace Shuttles (e.g. Speed Boat, Helicopter, Bus). Uses the public /api/public/vehicle-types endpoint and NEVER exposes individual vessel or operator names.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const data = await fetchJSON<VehicleTypesResponse>(
        `${baseUrl}/api/public/vehicle-types`
      );

      const names = unique(
        (data?.rows ?? []).map((v) => v.name ?? undefined)
      );

      if (!names.length) {
        const content =
          "We use premium categories of transport tailored to each route, such as speed boats and other high-end options. Specific vessel or operator names aren’t disclosed in advance of a booking.";
        return { messages: [{ role: "assistant", content }] };
      }

      const content =
        `We currently use the following categories of transport:\n• ${names.join(
          " • "
        )}\nThe exact mix depends on the territory and route, but individual vessel or operator names aren’t disclosed in advance of a booking.`;

      return { messages: [{ role: "assistant", content }] };
    },
  };

  return [
    listOperatingCountries,
    listDestinationsInCountry,
    describeDestinationByName,
    listPickupsInCountry,
    listRoutesInCountry,
    listTransportTypes,
  ];
}
