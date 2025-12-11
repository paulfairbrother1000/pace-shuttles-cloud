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
/*  Helper: sanitise conversation for OpenAI                                  */
/* -------------------------------------------------------------------------- */

function stripToolMessages(history: AgentMessage[]): AgentMessage[] {
  // Only keep user/assistant messages when we send the context to OpenAI.
  return history.filter(
    (m) => m.role === "user" || m.role === "assistant"
  );
}

/* -------------------------------------------------------------------------- */
/*  POST handler – tool-first agent                                           */
/* -------------------------------------------------------------------------- */

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    await supabase.auth.getUser(); // keeps auth flow consistent even if unused for now

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    // Strip out any tool messages from previous turns before calling OpenAI
    const conversation = stripToolMessages(body.messages || []);

    if (!conversation.length) {
      return NextResponse.json(
        { error: "No conversation history provided" },
        { status: 400 }
      );
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: SYSTEM_RULES },
        ...conversation,
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

      // ToolExecutionResult.messages is already an array of assistant-style messages.
      const toolMessages = result.messages ?? [];
      const combinedContent = toolMessages
        .map((m) => m.content)
        .filter(Boolean)
        .join("\n\n");

      const assistantMessage: AgentMessage = {
        role: "assistant",
        content:
          combinedContent ||
          "I’ve checked our live data and updated the information above.",
      };

      return NextResponse.json<AgentResponse>({
        // NOTE: we append a normal assistant message, NOT a 'tool' message
        messages: [...body.messages, assistantMessage],
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
