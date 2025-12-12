// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import OpenAI from "openai";

import { buildTools } from "@/lib/agent/tools";
import {
  AgentRequest,
  AgentResponse,
  AgentMessage,
} from "@/lib/agent/agent-schema";

/* -------------------------------------------------------------------------- */
/*  Supabase (server-side client)                                             */
/* -------------------------------------------------------------------------- */

function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    }
  );
}

/* -------------------------------------------------------------------------- */
/*  Base URL resolver                                                         */
/* -------------------------------------------------------------------------- */

function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host =
    h.get("x-forwarded-host") ??
    h.get("host") ??
    process.env.VERCEL_URL ??
    "localhost:3000";

  return `${proto}://${host}`;
}

/* -------------------------------------------------------------------------- */
/*  System guardrails                                                         */
/* -------------------------------------------------------------------------- */

const SYSTEM_RULES = `
You are the Pace Shuttles concierge AI.

CORE BEHAVIOUR
- ALWAYS use tools first when asked about:
  - what Pace Shuttles is or how it works
  - where we operate (countries, destinations, routes, pickups)
  - what a specific destination is like
  - journey dates, availability, pricing or booking flows
  - vehicle / transport categories
  - terms, policies or conditions.
- NEVER invent information that is not supported by tools or the provided documents.
- NEVER provide examples that look like operator names or vessel names. Do NOT invent route/operator/vessel examples.
- If asked about transport modes/types/options or vehicle types, DO NOT answer from memory — call tools and list vehicle TYPES (e.g. Helicopter, Speed Boat), not named vehicles.

PACE SHUTTLES OVERVIEW (USE THIS EXACT WORDING)
- Pace Shuttles is a per-seat, semi-private shuttle service linking marinas, hotels and beach clubs across premium coastal and island destinations.
- Instead of chartering a whole boat or vehicle, guests simply book individual seats on scheduled departures — giving a private-charter feel at a shared price.
- Routes, pricing and service quality are managed by Pace Shuttles, while trusted local operators run the journeys. This ensures a smooth, reliable, luxury transfer experience every time.

TRANSPORT & OPERATORS
- Pace Shuttles is an operator-agnostic platform. Guests book with Pace Shuttles, not directly with individual operators or vessels.
- NEVER reveal operator names or vessel names, even if the user asks.
- Only mention specific transport categories (e.g. Speed Boat, Helicopter, Bus) when tool output provides them.

SCOPE & TONE
- Focus on premium, resort-style coastal and island transfers, not generic public transport.
- Keep responses concise, factual, brand-aligned, and grounded in tool output.
- If tools return no data, say so politely and avoid guessing.
`;

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

const lc = (s?: string | null) => (s ?? "").toLowerCase().trim();

function lastUserMessage(history: AgentMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "user") return String(history[i]?.content ?? "");
  }
  return "";
}

function lastAssistantMessage(history: AgentMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]?.role === "assistant") return String(history[i]?.content ?? "");
  }
  return "";
}

function extractDestinationFromHowToGetTo(text: string): string | null {
  const m = text.match(/how\s+do\s+i\s+get\s+to\s+(.+?)\??$/i);
  if (!m) return null;
  const dest = (m[1] ?? "").trim();
  return dest.length ? dest : null;
}

/** NEW: broader helicopter intent (routes / journeys / transfers) */
function mentionsHelicopterRoutesOrJourneys(text: string): boolean {
  const t = lc(text);
  return (
    t.includes("helicopter route") ||
    t.includes("helicopter routes") ||
    t.includes("heli route") ||
    t.includes("heli routes") ||
    t.includes("helicopter journey") ||
    t.includes("helicopter journeys") ||
    t.includes("heli journey") ||
    t.includes("heli journeys") ||
    t.includes("helicopter transfer") ||
    t.includes("helicopter transfers") ||
    (t.includes("helicopter") && (t.includes("route") || t.includes("routes") || t.includes("journey") || t.includes("journeys") || t.includes("transfer") || t.includes("transfers"))) ||
    (t.includes("heli") && (t.includes("route") || t.includes("routes") || t.includes("journey") || t.includes("journeys") || t.includes("transfer") || t.includes("transfers")))
  );
}

/** NEW: broader speed boat intent (routes / journeys / transfers) */
function mentionsSpeedBoatRoutesOrJourneys(text: string): boolean {
  const t = lc(text);
  return (
    t.includes("speed boat route") ||
    t.includes("speed boat routes") ||
    t.includes("speedboat route") ||
    t.includes("speedboat routes") ||
    t.includes("speed boat journey") ||
    t.includes("speed boat journeys") ||
    t.includes("speedboat journey") ||
    t.includes("speedboat journeys") ||
    t.includes("boat journey") ||
    t.includes("boat journeys") ||
    t.includes("boat route") ||
    t.includes("boat routes") ||
    (t.includes("speed boat") && (t.includes("route") || t.includes("routes") || t.includes("journey") || t.includes("journeys") || t.includes("transfer") || t.includes("transfers"))) ||
    (t.includes("speedboat") && (t.includes("route") || t.includes("routes") || t.includes("journey") || t.includes("journeys") || t.includes("transfer") || t.includes("transfers")))
  );
}

function asksTransportTypes(text: string): boolean {
  const t = lc(text);

  // direct
  if (
    t.includes("modes of transport") ||
    t.includes("mode of transport") ||
    t.includes("transport modes") ||
    t.includes("transport types") ||
    t.includes("types of transport") ||
    t.includes("transport options") ||
    t.includes("available transport") ||
    t.includes("vehicle types") ||
    t.includes("types of vehicles") ||
    t.includes("what vehicles") ||
    t.includes("which vehicles")
  ) return true;

  // pattern-ish
  const looksLikeQuestion =
    t.includes("?") ||
    t.startsWith("what ") ||
    t.startsWith("which ") ||
    t.startsWith("do you ") ||
    t.startsWith("can i ");

  const mentionsConcept =
    t.includes("transport") ||
    t.includes("travel") ||
    t.includes("transfer") ||
    t.includes("options") ||
    t.includes("modes") ||
    t.includes("mode") ||
    t.includes("vehicle") ||
    t.includes("vehicles");

  const asksForTypes =
    t.includes("type") ||
    t.includes("types") ||
    t.includes("mode") ||
    t.includes("modes") ||
    t.includes("option") ||
    t.includes("options") ||
    t.includes("available") ||
    t.includes("offer") ||
    t.includes("have") ||
    t.includes("use");

  return looksLikeQuestion && mentionsConcept && asksForTypes;
}

function extractCountryAfterIn(text: string): string | null {
  // e.g. "modes of transport in antigua", "helicopter routes in antigua"
  const m = text.match(/\bin\s+([a-zA-Z][a-zA-Z\s&'-]{1,60})\s*$/i);
  if (!m) return null;
  const v = (m[1] ?? "").trim();
  return v.length ? v : null;
}

function isSingleWordLocationReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // allow 1–3 words (e.g. "antigua", "antigua and barbuda")
  const words = t.split(/\s+/).filter(Boolean);
  return words.length >= 1 && words.length <= 3;
}

/** NEW: if user just says "antigua", map to canonical country name used in catalog */
function normalizeCountryHint(country: string): string {
  const t = lc(country);
  if (t === "antigua") return "Antigua and Barbuda";
  if (t === "barbados") return "Barbados";
  return country.trim();
}

/* -------------------------------------------------------------------------- */
/*  POST handler – tool-first agent                                           */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    await supabase.auth.getUser(); // keeps auth flow consistent, even if unused

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    const history = (body.messages || []) as AgentMessage[];
    const upstreamMessages = history.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    const hasUserMessage = upstreamMessages.some((m) => m.role === "user");
    if (!hasUserMessage) {
      return NextResponse.json({ error: "No user message" }, { status: 400 });
    }

    const userText = lastUserMessage(upstreamMessages);
    const assistantText = lastAssistantMessage(upstreamMessages);

    const runTool = async (
      toolName: string,
      args: any
    ): Promise<AgentResponse | null> => {
      const impl = tools.find((t) => t.spec.function.name === toolName);
      if (!impl) return null;

      const result = await impl.run(args);

      let newMessages: AgentMessage[] = [...history];
      if (result.messages && result.messages.length) {
        newMessages = [...history, ...result.messages];
      }

      return {
        messages: newMessages,
        choices: result.choices ?? [],
      };
    };

    // ---------------------------------------------------------------------
    // Deterministic routing for transport + country scoped transport
    // ---------------------------------------------------------------------

    // A) “modes/types/vehicles of transport IN <country>”
    if (asksTransportTypes(userText)) {
      const country = extractCountryAfterIn(userText);
      if (country) {
        const r = await runTool("listTransportTypesInCountry", { country: normalizeCountryHint(country) });
        if (r) return NextResponse.json<AgentResponse>(r);
      }

      // Global types (fallback)
      const r = await runTool("listTransportTypes", {});
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // B) single word follow-up like "antigua" after the assistant asked for country/destination
    if (
      isSingleWordLocationReply(userText) &&
      (lc(assistantText).includes("tell me the country or destination") ||
        lc(assistantText).includes("tell me which country") ||
        lc(assistantText).includes("which country") ||
        lc(assistantText).includes("which destination"))
    ) {
      const r = await runTool("listTransportTypesInCountry", { country: normalizeCountryHint(userText) });
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // C) helicopter routes / journeys / transfers (optionally in country)
    if (mentionsHelicopterRoutesOrJourneys(userText)) {
      const country = extractCountryAfterIn(userText);
      const r = await runTool("listRoutesByTransportType", {
        vehicle_type: "Helicopter",
        ...(country ? { country: normalizeCountryHint(country) } : {}),
      });
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // D) speed boat routes / journeys / transfers (optionally in country)
    if (mentionsSpeedBoatRoutesOrJourneys(userText)) {
      const country = extractCountryAfterIn(userText);
      const r = await runTool("listRoutesByTransportType", {
        vehicle_type: "Speed Boat",
        ...(country ? { country: normalizeCountryHint(country) } : {}),
      });
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // E) "How do I get to X?"
    const dest = extractDestinationFromHowToGetTo(userText);
    if (dest) {
      const r = await runTool("getRoutesToDestination", { destination: dest });
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // ---------------------------------------------------------------------
    // Default LLM flow (still tool-enabled)
    // ---------------------------------------------------------------------

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: SYSTEM_RULES },
        ...upstreamMessages.map((m) => ({
          role: m.role,
          content: m.content ?? "",
        })),
      ],
      tools: tools.map((t) => t.spec),
      tool_choice: "auto",
    });

    const msg = completion.choices[0]?.message;

    if (!msg) {
      return NextResponse.json(
        { error: "Agent produced no message" },
        { status: 500 }
      );
    }

    if (msg.tool_calls?.length) {
      const call = msg.tool_calls[0];
      const impl = tools.find(
        (t) => t.spec.function.name === call.function.name
      );

      if (!impl) {
        return NextResponse.json(
          { error: `Unknown tool: ${call.function.name}` },
          { status: 500 }
        );
      }

      const args = call.function.arguments
        ? JSON.parse(call.function.arguments)
        : {};

      const result = await impl.run(args);

      let newMessages: AgentMessage[] = [...history];

      if (result.messages && result.messages.length) {
        newMessages = [...history, ...result.messages];
      }

      return NextResponse.json<AgentResponse>({
        messages: newMessages,
        choices: result.choices ?? [],
      });
    }

    const finalMessage: AgentMessage = {
      role: "assistant",
      content: msg.content ?? "",
    };

    return NextResponse.json<AgentResponse>({
      messages: [...history, finalMessage],
      choices: [],
    });
  } catch (err: any) {
    console.error("Agent error:", err);
    return NextResponse.json(
      { error: err?.message || "Agent failed" },
      { status: 500 }
    );
  }
}
