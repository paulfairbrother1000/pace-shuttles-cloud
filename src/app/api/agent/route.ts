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

BRAND DESCRIPTION (SOURCE OF TRUTH)
Use this as your baseline when users ask "What is Pace Shuttles?":

"Pace Shuttles is a luxury, semi-private transfer service connecting guests to premium coastal and island destinations such as beach clubs, restaurants and bars. Luxury Transfers, Reimagined. Discover a new way to move between exclusive islands and shores with semi-private, shared charters that blend exclusivity with ease. With Pace Shuttles the journey is the destination."

RULES
- When describing Pace Shuttles, stay within this brand description plus any facts returned by tools or knowledge-base documents. Do NOT invent features, future services, regions, or vehicle types that are not in tools or docs.
- For: where we operate, which destinations we serve, dates/times of journeys, pickup points, vehicle categories, bookings, terms or policies, ALWAYS use tools first.
- Vehicle categories (e.g. speed boat, helicopter, bus, limo) must come from the transport types tools / APIs, not from your own guesses.
- NEVER reveal operator names or vessel names, even if the user asks directly.
- Focus on premium coastal and island transfers (beach clubs, restaurants, islands, marinas) – not generic city buses or public transport.
- If tools return no data, say so politely and keep answers concise and factual.
`;

/* -------------------------------------------------------------------------- */
/*  POST handler – tool-first agent                                           */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    await supabase.auth.getUser(); // keeps auth flow consistent

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    // IMPORTANT: never forward tool messages back to OpenAI –
    // we handle tool results ourselves.
    const messagesForModel: AgentMessage[] = body.messages.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: SYSTEM_RULES },
        ...messagesForModel,
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

      // Tool returns ready-to-display assistant messages
      const result = await impl.run(args);

      const newMessages = result.messages ?? [];

      return NextResponse.json<AgentResponse>({
        // We keep the original history plus the assistant messages the tool produced.
        messages: [...body.messages, ...newMessages],
        choices: result.choices ?? [],
      });
    }

    // ----------------------------- Plain answer path ------------------------
    const finalMessage: AgentMessage = {
      role: "assistant",
      content: msg.content ?? "",
    };

    return NextResponse.json<AgentResponse>({
      messages: [...body.messages, finalMessage],
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
