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
  - journey dates, availability, pricing or booking flows
  - vehicle / transport categories
  - terms, policies or conditions.
- NEVER invent information that is not supported by tools or the provided documents.

TRANSPORT & OPERATORS
- Pace Shuttles is an operator-agnostic platform. Guests book with Pace Shuttles,
  not directly with individual operators or vessels.
- NEVER reveal operator names or vessel names, even if the user asks.
- When giving a high-level description of the service, DO NOT list specific
  vehicle categories (boats, helicopters, limos, etc). Use neutral phrases like
  "premium transport", "luxury shuttles" or "semi-private transfers".
- Only mention specific transport categories (e.g. Helicopter, Speed Boat, Bus, Limo)
  when you have called the listTransportTypes tool and are reflecting its output.

SCOPE & TONE
- Focus on premium coastal and island transfers (beach clubs, restaurants, hotels,
  marinas, anchorages) – not generic city buses or airport shuttles.
- Keep responses concise, factual, and grounded in tool output or the brand
  description.
- If tools return no data or only partial data, say so politely and avoid guessing.
`;

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

    // ---- IMPORTANT: strip out tool messages before sending to OpenAI ----
    const history = (body.messages || []) as AgentMessage[];

    const upstreamMessages = history.filter(
      (m) => m.role === "user" || m.role === "assistant"
    );

    const userMessage = upstreamMessages.findLast((m) => m.role === "user");
    if (!userMessage) {
      return NextResponse.json(
        { error: "No user message" },
        { status: 400 }
      );
    }

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

      const toolMessage: AgentMessage = {
        role: "tool",
        name: call.function.name,
        content: JSON.stringify(result),
      };

      return NextResponse.json<AgentResponse>({
        messages: [...history, toolMessage],
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
