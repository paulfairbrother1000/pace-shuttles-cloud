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

BRAND SUMMARY (ALWAYS TRUE):
Pace Shuttles is a luxury, semi-private transfer service that connects guests
to premium coastal and island destinations – beach clubs, restaurants, hotels,
marinas and anchorages. Journeys are typically operated by modern, high-end
boats, with scope to include other premium transport (such as helicopters or
private vehicles) in future territories. The journey should feel like part of
the vacation, not like a taxi, airport bus, or generic public transport.

RULES:
- When the user asks about live routes, where we operate, availability,
  bookings, pricing, terms or policies, CALL THE RELEVANT TOOLS and base your
  answer on their output.
- For general "what is Pace Shuttles" / "tell me about Pace Shuttles" / "what
  do you do?" questions, answer DIRECTLY using the BRAND SUMMARY above. You may
  optionally call tools if it genuinely helps, but it is not required.
- NEVER reveal operator names or individual vessel/boat names, even if the user
  asks. Always talk in terms of generic transport categories (e.g. "luxury
  boat", "helicopter", "premium vehicle").
- Focus on premium coastal and island transfers – not airports, commuter buses,
  or generic public transport.
- If tools return no relevant data, say so briefly if needed, then fall back to
  the BRAND SUMMARY and other always-true information instead of mentioning
  "public documents".
- Keep responses concise and factual, and grounded in tool output plus this
  BRAND SUMMARY.
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
      const final: AgentMessage =
        assistantMessages[assistantMessages.length - 1] ?? {
          role: "assistant",
          content:
            "I checked our live data but couldn't find anything more specific. Pace Shuttles is a luxury, semi-private transfer service connecting guests to premium coastal and island destinations.",
        };

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
