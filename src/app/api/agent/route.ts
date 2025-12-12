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
- NEVER provide examples that look like operator names or vessel names. Do NOT invent route/operator examples.

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

function extractDestinationFromHowToGetTo(text: string): string | null {
  // Examples:
  // "How do I get to Nobu?"
  // "how do i get to Nobu Barbuda"
  const m = text.match(/how\s+do\s+i\s+get\s+to\s+(.+?)\??$/i);
  if (!m) return null;
  const dest = (m[1] ?? "").trim();
  return dest.length ? dest : null;
}

function mentionsHelicopterRoutes(text: string): boolean {
  const t = lc(text);
  return (
    t.includes("helicopter route") ||
    t.includes("helicopter routes") ||
    t.includes("heli route") ||
    t.includes("heli routes") ||
    (t.includes("helicopter") && t.includes("routes"))
  );
}

function mentionsSpeedBoatRoutes(text: string): boolean {
  const t = lc(text);
  return (
    t.includes("speed boat route") ||
    t.includes("speed boat routes") ||
    t.includes("speedboat route") ||
    t.includes("speedboat routes") ||
    (t.includes("speed boat") && t.includes("routes")) ||
    (t.includes("speedboat") && t.includes("routes"))
  );
}

function asksTransportTypes(text: string): boolean {
  const t = lc(text);
  return (
    t.includes("transport types") ||
    t.includes("what types") ||
    t.includes("which types") ||
    t.includes("what transport") ||
    t.includes("transport options") ||
    t.includes("what options") ||
    t.includes("available transport")
  );
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

    // ---- Strip out any tool messages before sending to OpenAI ------------
    const history = (body.messages || []) as AgentMessage[];
    const upstreamMessages = history.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    const hasUserMessage = upstreamMessages.some((m) => m.role === "user");
    if (!hasUserMessage) {
      return NextResponse.json({ error: "No user message" }, { status: 400 });
    }

    // ---------------------------------------------------------------------
    // Deterministic routing for the high-risk regression areas
    // (prevents hallucinated transport types, and wrong "no helicopter routes")
    // ---------------------------------------------------------------------
    const userText = lastUserMessage(upstreamMessages);

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

    // 1) "What transport types are available?" -> ALWAYS DB-driven listTransportTypes
    if (asksTransportTypes(userText)) {
      const r = await runTool("listTransportTypes", {});
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // 2) "Helicopter routes" -> ALWAYS listRoutesByTransportType(Helicopter)
    if (mentionsHelicopterRoutes(userText)) {
      const r = await runTool("listRoutesByTransportType", {
        vehicle_type: "Helicopter",
      });
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // 3) "Speed boat routes" -> ALWAYS listRoutesByTransportType(Speed Boat)
    if (mentionsSpeedBoatRoutes(userText)) {
      const r = await runTool("listRoutesByTransportType", {
        vehicle_type: "Speed Boat",
      });
      if (r) return NextResponse.json<AgentResponse>(r);
    }

    // 4) "How do I get to X?" -> ALWAYS getRoutesToDestination(destination=X)
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

    // ----------------------------- Tool call path ---------------------------
    if (msg.tool_calls?.length) {
      // NOTE: existing behavior: execute first tool call only
      // (kept as-is here to minimise changes; deterministic routing above
      // covers the problematic intents)
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

    // ----------------------------- Plain answer path ------------------------
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
