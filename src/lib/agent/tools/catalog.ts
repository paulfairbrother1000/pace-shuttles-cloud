// src/lib/agent/tools/catalog.ts
import type { ToolContext, ToolDefinition, ToolExecutionResult } from "./index";

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
  vehicle_type_name: string | null; // ⚠️ may be polluted (e.g. vessel names) — do not trust as SSOT
};

type VisibleVehicleType = {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  icon_url?: string | null;
  capacity?: number | null;
  features?: string[] | null;
};

type VisibleCatalog = {
  ok: boolean;
  fallback?: boolean;
  routes: VisibleRoute[];
  countries: any[];
  destinations: any[];
  pickups: any[];
  vehicle_types: VisibleVehicleType[];
};

/* -------------------------------------------------------------------------- */
/*  Types mirroring /api/public/destinations (DB-driven)                      */
/* -------------------------------------------------------------------------- */

type DestinationRow = {
  name: string;
  country_name: string | null;
  description: string | null;
  address1: string | null;
  address2: string | null;
  town: string | null;
  region: string | null;
  postal_code: string | null;
  phone: string | null;
  website_url: string | null;
  image_url: string | null;
  directions_url: string | null;
  active: boolean;
};

type DestinationsResponse = {
  ok: boolean;
  rows: DestinationRow[];
  count: number;
};

/* -------------------------------------------------------------------------- */

const lc = (s?: string | null) => (s ?? "").toLowerCase().trim();

function normaliseCountryName(name: string | null | undefined): string {
  if (!name) return "";
  return lc(name).replace(/&/g, "and").replace(/\s+/g, " ");
}

function normaliseVehicleTypeName(name: string | null | undefined): string {
  const s = lc(name).replace(/\s+/g, " ");
  if (!s) return "";

  // Common synonyms / variations
  if (s === "speedboat") return "speed boat";
  if (s === "rib") return "speed boat";
  if (s === "heli") return "helicopter";
  if (s === "chopper") return "helicopter";

  return s;
}

function titleCaseVehicleType(norm: string): string {
  const s = normaliseVehicleTypeName(norm);
  if (!s) return "";
  if (s === "speed boat") return "Speed Boat";
  if (s === "helicopter") return "Helicopter";
  if (s === "bus") return "Bus";
  if (s === "limo") return "Limo";
  // Fallback: Title Case each word
  return s
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

function uniqueByKey<T>(items: T[], keyFn: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const k = keyFn(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function normaliseDestinationQuery(q: string): string {
  return lc(q)
    .replace(/[’']/g, "'")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function destMatches(routeDestName: string | null | undefined, q: string): boolean {
  const dn = normaliseDestinationQuery(routeDestName ?? "");
  const qq = normaliseDestinationQuery(q);
  if (!dn || !qq) return false;

  // Exact or substring match (handles "Nobu", "Nobu Barbuda", etc.)
  return dn === qq || dn.includes(qq) || qq.includes(dn);
}

/**
 * IMPORTANT:
 * Some environments have `routes[].vehicle_type_name` polluted with vessel names
 * (e.g. "Silver Lady"). Therefore:
 * - SSOT for transport types is `catalog.vehicle_types` (generic types table)
 * - SSOT for route filtering by transport type is `routes[].vehicle_type_id`
 */
function getVehicleTypeMap(cat: VisibleCatalog | null): Map<string, string> {
  const m = new Map<string, string>();
  const rows = (cat?.vehicle_types ?? []).filter(Boolean);
  for (const t of rows) {
    const id = (t.id ?? "").toString().trim();
    const name = (t.name ?? "").toString().trim();
    if (!id || !name) continue;
    m.set(id, name);
  }
  return m;
}

function getTypeIdsByName(cat: VisibleCatalog | null, vehicleNorm: string): string[] {
  const want = normaliseVehicleTypeName(vehicleNorm);
  if (!want) return [];

  const ids: string[] = [];
  for (const t of cat?.vehicle_types ?? []) {
    const id = (t?.id ?? "").toString().trim();
    const name = titleCaseVehicleType(String(t?.name ?? ""));
    const normName = normaliseVehicleTypeName(name);
    if (!id) continue;
    if (normName === want) ids.push(id);
  }
  return ids;
}

function prettyTypeNameFromId(typeId: string | null | undefined, typeMap: Map<string, string>): string {
  if (!typeId) return "";
  const n = typeMap.get(typeId) ?? "";
  return titleCaseVehicleType(n) || n;
}

/* -------------------------------------------------------------------------- */
/*  Shared fetch helper                                                       */
/* -------------------------------------------------------------------------- */

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

async function loadDestinations(baseUrl: string): Promise<DestinationRow[]> {
  const data = await fetchJSON<DestinationsResponse>(`${baseUrl}/api/public/destinations`);
  if (!data?.ok || !Array.isArray(data.rows)) return [];
  return data.rows.filter((d) => d.active);
}

/* -------------------------------------------------------------------------- */
/*  Catalog tool implementations                                              */
/* -------------------------------------------------------------------------- */

export function catalogTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  /* 1) Countries where we operate (LIVE/BOOKABLE) */
  const listOperatingCountries: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listOperatingCountries",
        description:
          "List the countries where Pace Shuttles currently has live, bookable routes according to the public catalog.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
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

  /* 2) Destinations we visit within a given country (DB-driven, NOT schedule-driven) */
  const listDestinationsInCountry: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listDestinationsInCountry",
        description:
          "Given a country name, list the destinations Pace Shuttles currently serves in that country based on the destinations catalogue (DB-driven).",
        parameters: {
          type: "object",
          properties: {
            country: {
              type: "string",
              description: "Country name from the user question, e.g. 'Antigua and Barbuda' or 'Barbados'.",
            },
          },
          required: ["country"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const countryRaw = String(args.country || "").trim();
      const normQuery = normaliseCountryName(countryRaw);

      const destinations = await loadDestinations(baseUrl);
      if (!destinations.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t reach the destinations catalogue just now, so I can’t list destinations. Please try again in a moment.",
            },
          ],
        };
      }

      const inCountry = destinations.filter((d) => normaliseCountryName(d.country_name) === normQuery);

      if (!inCountry.length) {
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any active destinations listed in ${countryRaw} yet.`,
            },
          ],
        };
      }

      const dests = unique(inCountry.map((d) => d.name));
      const prettyCountry = inCountry[0].country_name || countryRaw;

      const content = `In ${prettyCountry}, we currently visit:\n• ${dests.join(" • ")}`;
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 3) Pickup / boarding points in a given country (LIVE/BOOKABLE) */
  const listPickupsInCountry: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listPickupsInCountry",
        description:
          "Given a country name, list the pickup / boarding locations for journeys in that country (e.g. marinas, harbours, heliports) based on the live catalog.",
        parameters: {
          type: "object",
          properties: {
            country: {
              type: "string",
              description: "Country name from the user question, e.g. 'Antigua and Barbuda' or 'Barbados'.",
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
              content: "I couldn’t find any live pickup locations yet. Please check back soon as routes go live.",
            },
          ],
        };
      }

      const inCountry = cat.routes.filter((r) => normaliseCountryName(r.country_name) === normQuery);

      if (!inCountry.length) {
        return {
          messages: [{ role: "assistant", content: `I couldn’t find any live routes in ${countryRaw} yet.` }],
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

      const content = `In ${prettyCountry}, our current pickup / boarding points include:\n• ${pickups.join(" • ")}`;
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 4) Routes (pickup → destination) in a given country (LIVE/BOOKABLE) */
  const listRoutesInCountry: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listRoutesInCountry",
        description:
          "Given a country name, list the shuttle routes in that country as pickup → destination pairs based on the live catalog.",
        parameters: {
          type: "object",
          properties: {
            country: {
              type: "string",
              description: "Country name from the user question, e.g. 'Antigua and Barbuda' or 'Barbados'.",
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
              content: "I couldn’t find any live routes right now. Please check back soon as services go live.",
            },
          ],
        };
      }

      const inCountry = cat.routes.filter((r) => normaliseCountryName(r.country_name) === normQuery);

      if (!inCountry.length) {
        return {
          messages: [{ role: "assistant", content: `I couldn’t find any live routes in ${countryRaw} yet.` }],
        };
      }

      const routes = unique(inCountry.map((r) => r.route_name || `${r.pickup_name} → ${r.destination_name}`));
      const prettyCountry = inCountry[0].country_name || countryRaw;

      const content = `In ${prettyCountry}, our current routes include:\n• ${routes.join(" • ")}`;
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 5) Transport categories (SSOT: cat.vehicle_types, NOT routes[].vehicle_type_name) */
  const listTransportTypes: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listTransportTypes",
        description:
          "List the generic categories of transport currently used by Pace Shuttles based on the live catalog. Use the generic vehicle_types list and NEVER reveal specific operator or vessel names.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const cat = await loadVisibleCatalog(baseUrl);

      // If catalog unavailable, keep safe + generic
      if (!cat) {
        const content =
          "We use premium transport categories such as Speed Boat, Helicopter, Bus and Limo. The exact mix depends on the territory and route, but individual vessel or operator names aren’t disclosed in advance of a booking.";
        return { messages: [{ role: "assistant", content }] };
      }

      // SSOT: generic types table (already filtered in the API where possible)
      const typeNames = unique((cat.vehicle_types ?? []).map((t) => (t?.name ?? "").toString()));
      const pretty = unique(typeNames.map((n) => titleCaseVehicleType(n))).filter(Boolean);

      if (!pretty.length) {
        const content =
          "We use premium transport options depending on the territory and route. If you tell me the country or destination, I can show what’s currently available.";
        return { messages: [{ role: "assistant", content }] };
      }

      const content =
        `We use premium transport categories such as ${pretty.join(", ")}. ` +
        "The exact mix depends on the territory and route, but individual vessel or operator names aren’t disclosed in advance of a booking.";
      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 6) Routes by transport type (SSOT: route.vehicle_type_id ↔ cat.vehicle_types) */
  const listRoutesByTransportType: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "listRoutesByTransportType",
        description:
          "List live routes filtered by transport category (e.g. Helicopter, Speed Boat). Optionally filter to a country. Uses generic type IDs to avoid leaking vessel names. Returns pickup → destination route names only (no operators/vessels).",
        parameters: {
          type: "object",
          properties: {
            vehicle_type: {
              type: "string",
              description: "Transport category, e.g. 'Helicopter', 'Speed Boat', 'Bus', 'Limo'.",
            },
            country: {
              type: "string",
              description:
                "Optional country name to limit results, e.g. 'Antigua and Barbuda'. If omitted, returns all matching routes across all countries.",
            },
          },
          required: ["vehicle_type"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const vehicleRaw = String(args.vehicle_type || "").trim();
      const vehicleNorm = normaliseVehicleTypeName(vehicleRaw);

      const countryRaw = args.country ? String(args.country || "").trim() : "";
      const countryNorm = countryRaw ? normaliseCountryName(countryRaw) : "";

      const cat = await loadVisibleCatalog(baseUrl);
      if (!cat || !cat.routes?.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t reach the live routes catalogue just now, so I can’t list routes by transport type. Please try again in a moment.",
            },
          ],
        };
      }

      const typeMap = getVehicleTypeMap(cat);
      const matchingTypeIds = getTypeIdsByName(cat, vehicleNorm);

      // If we can't resolve the type id from the generic list, fail safely
      if (!matchingTypeIds.length) {
        const prettyVehicle = titleCaseVehicleType(vehicleNorm) || vehicleRaw;
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t match “${prettyVehicle}” to a known transport category in our catalogue yet.`,
            },
          ],
        };
      }

      const filtered = cat.routes.filter((r) => {
        const id = (r.vehicle_type_id ?? "").toString();
        if (!id || !matchingTypeIds.includes(id)) return false;
        if (!countryNorm) return true;
        return normaliseCountryName(r.country_name) === countryNorm;
      });

      if (!filtered.length) {
        const prettyVehicle = titleCaseVehicleType(vehicleNorm) || vehicleRaw;
        if (countryRaw) {
          return {
            messages: [
              {
                role: "assistant",
                content: `I couldn’t find any live ${prettyVehicle} routes in ${countryRaw} yet.`,
              },
            ],
          };
        }
        return {
          messages: [
            {
              role: "assistant",
              content: `I couldn’t find any live ${prettyVehicle} routes listed yet.`,
            },
          ],
        };
      }

      // De-dup routes by pickup+destination+country+vehicle_type_id
      const uniq = uniqueByKey(filtered, (r) => {
        const c = normaliseCountryName(r.country_name);
        const p = lc(r.pickup_name);
        const d = lc(r.destination_name);
        const v = (r.vehicle_type_id ?? "").toString().trim();
        return `${c}|${p}|${d}|${v}`;
      });

      // Group by country for readability when country not provided
      const byCountry = new Map<string, VisibleRoute[]>();
      for (const r of uniq) {
        const c = r.country_name || "Unknown country";
        if (!byCountry.has(c)) byCountry.set(c, []);
        byCountry.get(c)!.push(r);
      }

      const prettyVehicle = titleCaseVehicleType(vehicleNorm) || vehicleRaw;

      if (countryRaw) {
        const prettyCountry = uniq[0]?.country_name || countryRaw;
        const routes = unique(uniq.map((r) => r.route_name || `${r.pickup_name} → ${r.destination_name}`));
        const content = `In ${prettyCountry}, our current ${prettyVehicle} routes include:\n• ${routes.join(" • ")}`;
        return { messages: [{ role: "assistant", content }] };
      }

      const blocks: string[] = [];
      for (const [country, rows] of byCountry.entries()) {
        const routes = unique(rows.map((r) => r.route_name || `${r.pickup_name} → ${r.destination_name}`));
        if (!routes.length) continue;
        blocks.push(`${country}:\n• ${routes.join(" • ")}`);
      }

      const content =
        blocks.length > 0
          ? `Here are our current ${prettyVehicle} routes (live / bookable):\n\n${blocks.join("\n\n")}`
          : `I couldn’t find any live ${prettyVehicle} routes listed yet.`;

      return { messages: [{ role: "assistant", content }] };
    },
  };

  /* 7) “How do I get to X?” — routes to a destination, grouped by transport type (SSOT: ids) */
  const getRoutesToDestination: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "getRoutesToDestination",
        description:
          "Given a destination name (e.g. 'Nobu'), list live routes that arrive there, grouped by transport category. Optionally filter to a country. Uses generic type IDs to avoid leaking vessel names. No operators/vessels.",
        parameters: {
          type: "object",
          properties: {
            destination: {
              type: "string",
              description: "Destination name the user asked about, e.g. 'Nobu' or 'Nobu Barbuda'.",
            },
            country: {
              type: "string",
              description:
                "Optional country name to limit results, e.g. 'Antigua and Barbuda'. If omitted, returns all matching routes across all countries.",
            },
          },
          required: ["destination"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const destRaw = String(args.destination || "").trim();
      const countryRaw = args.country ? String(args.country || "").trim() : "";
      const countryNorm = countryRaw ? normaliseCountryName(countryRaw) : "";

      const cat = await loadVisibleCatalog(baseUrl);
      if (!cat || !cat.routes?.length) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t reach the live routes catalogue just now, so I can’t look up routes to that destination. Please try again in a moment.",
            },
          ],
        };
      }

      const typeMap = getVehicleTypeMap(cat);

      const arriving = cat.routes.filter((r) => {
        if (!destMatches(r.destination_name, destRaw)) return false;
        if (!countryNorm) return true;
        return normaliseCountryName(r.country_name) === countryNorm;
      });

      if (!arriving.length) {
        if (countryRaw) {
          return {
            messages: [{ role: "assistant", content: `I couldn’t find any live routes to ${destRaw} in ${countryRaw} yet.` }],
          };
        }
        return {
          messages: [{ role: "assistant", content: `I couldn’t find any live routes to ${destRaw} yet.` }],
        };
      }

      const prettyDest = arriving[0]?.destination_name || destRaw;

      // De-dup by pickup+destination+country+vehicle_type_id
      const uniq = uniqueByKey(arriving, (r) => {
        const c = normaliseCountryName(r.country_name);
        const p = lc(r.pickup_name);
        const d = lc(r.destination_name);
        const v = (r.vehicle_type_id ?? "").toString().trim();
        return `${c}|${p}|${d}|${v}`;
      });

      // Group by vehicle type (from id map)
      const byVehicle = new Map<string, VisibleRoute[]>();
      for (const r of uniq) {
        const vt = prettyTypeNameFromId(r.vehicle_type_id, typeMap) || "Transport";
        if (!byVehicle.has(vt)) byVehicle.set(vt, []);
        byVehicle.get(vt)!.push(r);
      }

      const parts: string[] = [];
      for (const [vt, rows] of byVehicle.entries()) {
        const routes = unique(rows.map((r) => r.route_name || `${r.pickup_name} → ${r.destination_name}`));
        if (!routes.length) continue;
        parts.push(`**${vt}**\n• ${routes.join(" • ")}`);
      }

      const prefix = countryRaw
        ? `Here’s how to get to ${prettyDest} in ${countryRaw} (live / bookable routes):`
        : `Here’s how to get to ${prettyDest} (live / bookable routes):`;

      const content =
        parts.length > 0
          ? `${prefix}\n\n${parts.join("\n\n")}`
          : `I found routes to ${prettyDest}, but couldn’t classify them by transport type yet.`;

      return { messages: [{ role: "assistant", content }] };
    },
  };

  return [
    listOperatingCountries,
    listDestinationsInCountry,
    listPickupsInCountry,
    listRoutesInCountry,
    listTransportTypes,
    listRoutesByTransportType,
    getRoutesToDestination,
  ];
}
