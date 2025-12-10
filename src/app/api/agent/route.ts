// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import OpenAI from "openai";

import { buildTools } from "@/lib/agent/tools";
import {
  AgentRequest,
  AgentResponse,
  AgentMessage
} from "@/lib/agent/agent-schema";

// ---------------------------------------------------------------------------
// Supabase (server-side client)
// ---------------------------------------------------------------------------
function getSupabaseClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookies) => {
          cookies.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Base URL resolver
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// SYSTEM GUARDRAILS (no description, no narrative)
// ---------------------------------------------------------------------------
const SYSTEM_RULES = `
You are the Pace Shuttles concierge AI.

RULES:
- ALWAYS use tools first when asked about: what Pace Shuttles is, how it works,
  routes, destinations, pickups, vehicle categories, terms, policies.
- NEVER invent information.
- NEVER reveal operator names or vessel names.
- NEVER discuss airports, airlines, taxis, buses, or unrelated transport.
- If a tool returns no data, say so politely.
- Keep responses concise and factual.
- You are NOT allowed to guess; you must defer to tools.
`;

// ---------------------------------------------------------------------------
// POST handler — FULL TOOL-FIRST PIPELINE
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    await supabase.auth.getUser();

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    // -----------------------------------------------------------------------
    // ALWAYS enforce tool-first behaviour by placing system message first
    // -----------------------------------------------------------------------
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [
        { role: "system", content: SYSTEM_RULES },
        ...body.messages
      ],
      tools: tools.map(t => t.spec),
      tool_choice: "auto"
    });

    const msg = completion.choices[0]?.message;

    if (!msg) {
      return NextResponse.json({ error: "Agent produced no message" }, { status: 500 });
    }

    // -----------------------------------------------------------------------
    // TOOL CALL
    // -----------------------------------------------------------------------
    if (msg.tool_calls?.length) {
      const call = msg.tool_calls[0];
      const impl = tools.find(t => t.spec.function.name === call.function.name);

      if (!impl) {
        return NextResponse.json({
          error: `Unknown tool: ${call.function.name}`
        });
      }

      const args = call.function.arguments
        ? JSON.parse(call.function.arguments)
        : {};

      const result = await impl.run(args);

      const toolResponse: AgentMessage = {
        role: "tool",
        name: call.function.name,
        content: JSON.stringify(result)
      };

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, toolResponse],
        choices: result.choices ?? []
      });
    }

    // -----------------------------------------------------------------------
    // FINAL MESSAGE (after tool call or plain completion)
    // -----------------------------------------------------------------------
    const finalMessage: AgentMessage = {
      role: "assistant",
      content: msg.content ?? ""
    };

    return NextResponse.json<AgentResponse>({
      messages: [...body.messages, finalMessage],
      choices: []
    });

  } catch (err: any) {
    console.error("Agent error:", err);
    return NextResponse.json(
      { error: err?.message || "Agent failed" },
      { status: 500 }
    );
  }
}
