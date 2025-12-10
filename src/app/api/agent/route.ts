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

RULES:
- ALWAYS use tools first when asked about what Pace Shuttles is, how it works,
  where we operate, routes, destinations, pickups, vehicle categories, terms or
  policies.
- NEVER invent information.
- NEVER reveal operator names or vessel names.
- Focus on premium coastal and island transfers (beach clubs, restaurants,
  islands, marinas) – not airports, city buses or generic public transport.
- If tools return no data, say so politely.
- Keep responses concise and factual.
`;

/* -------------------------------------------------------------------------- */
/*  POST handler – tool-first agent                                           */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    await supabase.auth.getUser(); // we don't use user yet, but this keeps auth flow consistent

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: SYSTEM_RULES },
        ...body.messages,
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

      // Tools return assistant-style messages; unwrap them and send back
      // a normal assistant reply instead of a tool message / raw JSON.
      const assistantMessages = result.messages ?? [];
      const final =
        assistantMessages[assistantMessages.length - 1] ??
        ({
          role: "assistant",
          content:
            "I ran an internal tool but it didn’t return any readable answer.",
        } as const);

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, final],
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
