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

type VisibleDestination = {
  id: string;
  name: string;
  description?: string | null;
  address?: string | null;
  country_name?: string | null; // may be present depending on API
};

type VisiblePickup = {
  id: string;
  name: string;
  description?: string | null;
  address?: string | null;
  country_name?: string | null;
};

type VisibleCatalog = {
  ok: boolean;
  fallback?: boolean;
  routes: VisibleRoute[];
  countries: any[];
  destinations: VisibleDestination[];
  pickups: VisiblePickup[];
  vehicle_types: any[];
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

  /* 5) High-level transport categories – GENERIC, no vessel names */
  const listTransportTypes: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listTransportTypes",
        description:
          "Describe the generic categories of transport used by Pace Shuttles (e.g. Speed Boat, Helicopter, Bus, Limo). NEVER reveal specific operator or vessel names.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      // Hard-coded to avoid any chance of leaking vessel / operator names.
      const content =
        "We currently use premium transport categories such as Speed Boat, Helicopter, Bus and Limo. The exact mix depends on the territory and route, but individual vessel or operator names aren’t disclosed in advance of a booking.";
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 6) Describe a specific pickup or destination in the network */
  const describeNetworkLocation: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "describeNetworkLocation",
        description:
          "Given the name of a pickup or destination (e.g. 'Nobu', 'Boom', 'The Cliff', 'Loose Canon'), describe it as a place served by Pace Shuttles. Use any description/address stored in the catalog if available, and mention which country it is in and that it is used as a pickup/drop-off point on selected routes.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "The place name the user mentioned, e.g. 'The Cliff', 'Boom', 'Loose Canon', 'Nobu'.",
            },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const rawName = String(args.name || "").trim();
      if (!rawName) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "Which location would you like to know about? For example: Boom, Loose Canon, The Cliff, Nobu…",
            },
          ],
        };
      }

      const nameLc = lc(rawName);
      const cat = await loadVisibleCatalog(baseUrl);

      if (!cat) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t load our destination catalog just now. Please try again in a moment.",
            },
          ],
        };
      }

      // Find matching destination or pickup
      const destMatch =
        cat.destinations?.find((d) => lc(d.name) === nameLc) ??
        cat.destinations?.find((d) => lc(d.name).includes(nameLc));

      const pickupMatch =
        cat.pickups?.find((p) => lc(p.name) === nameLc) ??
        cat.pickups?.find((p) => lc(p.name).includes(nameLc));

      const place = destMatch ?? pickupMatch;

      if (!place) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find a live pickup or destination called “${rawName}” in the current schedule. It might not be active yet, or it may be called something slightly different in our system.`,
            },
          ],
        };
      }

      // Try to infer country + sample routes mentioning this place
      let countryName: string | null = (place as any).country_name ?? null;

      if (!countryName && cat.routes?.length) {
        const routeHit = cat.routes.find(
          (r) =>
            lc(r.destination_name) === lc(place.name) ||
            lc(r.pickup_name) === lc(place.name)
        );
        if (routeHit) countryName = routeHit.country_name ?? null;
      }

      const niceName = place.name;
      const prettyCountry = countryName || "our network";

      const description = (place.description || "").trim();
      const address = (place.address || "").trim();

      // Sample up to 3 routes that touch this place
      const relatedRoutes =
        cat.routes
          ?.filter(
            (r) =>
              lc(r.destination_name) === lc(place.name) ||
              lc(r.pickup_name) === lc(place.name)
          )
          .slice(0, 3) || [];

      const routeSnippets = relatedRoutes.map((r) => {
        const from = r.pickup_name || "Pickup";
        const to = r.destination_name || "Destination";
        return `${from} → ${to}`;
      });

      const bits: string[] = [];

      bits.push(
        `${niceName} is one of the destinations served by Pace Shuttles in ${prettyCountry}. It’s used as a pick-up and drop-off point on selected shuttle routes.`
      );

      if (description) {
        bits.push(description);
      }

      if (address) {
        bits.push(`Address: ${address}.`);
      }

      if (routeSnippets.length) {
        bits.push(
          `Example routes that include this location are: ${routeSnippets.join(
            " • "
          )}.`
        );
      }

      bits.push(
        "If you’d like, I can also show you upcoming shuttle journeys serving this location on specific dates."
      );

      return {
        messages: [
          {
            role: "assistant",
            content: bits.join(" "),
          },
        ],
      };
    },
  };

  return [
    listOperatingCountries,
    listDestinationsInCountry,
    listPickupsInCountry,
    listRoutesInCountry,
    listTransportTypes,
    describeNetworkLocation,
  ];
}
