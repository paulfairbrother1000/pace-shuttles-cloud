// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import OpenAI from "openai";
import { cookies, headers } from "next/headers";
import {
  buildTools,
  type ToolExecutionResult
} from "@/lib/agent/tools";
import {
  AgentRequest,
  AgentResponse,
  AgentMessage
} from "@/lib/agent/agent-schema";

// ─────────────────────────────────────────────
// Supabase (server-side user resolution)
// ─────────────────────────────────────────────
function getSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // New @supabase/ssr API: must provide getAll + setAll
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch {
              // In some edge cases headers may already be committed.
              // We swallow the error instead of crashing the agent.
            }
          });
        }
      }
    }
  );
}

// ─────────────────────────────────────────────
// Base URL resolver (prod + local)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// The Agent Handler
// ─────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();
    // `user` is available for tools that need it

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const tools = buildTools({ baseUrl, supabase });

    // Last user message is the prompt
    const userMessage = body.messages.findLast(m => m.role === "user");
    if (!userMessage) {
      return NextResponse.json({ error: "No user message" }, { status: 400 });
    }

    // Run the agent
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: body.messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      tools: tools.map(t => t.spec),
      tool_choice: "auto"
    });

    const msg = completion.choices[0]?.message;
    if (!msg) {
      return NextResponse.json({ error: "No message returned" }, { status: 500 });
    }

    // ─────────────────────────────────────────────
    // Handle tool call if requested
    // ─────────────────────────────────────────────
    if (msg.tool_calls?.length) {
      const toolCall = msg.tool_calls[0]; // first tool call only for now
      const impl = tools.find(
        t => t.spec.function?.name === toolCall.function.name
      );

      if (!impl) {
        const fallbackMessage: AgentMessage = {
          role: "assistant",
          content: `Sorry, I tried to use a tool called "${toolCall.function.name}" but it isn't available.`
        };

        return NextResponse.json<AgentResponse>({
          messages: [...body.messages, fallbackMessage],
          choices: []
        });
      }

      const args = JSON.parse(toolCall.function.arguments || "{}");
      const result: ToolExecutionResult = await impl.run(args, {
        baseUrl,
        supabase
      });

      // If the tool returned assistant-ready messages, send them straight back.
      if (result.messages && result.messages.length > 0) {
        return NextResponse.json<AgentResponse>({
          messages: [...body.messages, ...result.messages],
          choices: result.choices ?? []
        });
      }

      // Safety net: tool ran but didn’t return any messages
      const fallbackMessage: AgentMessage = {
        role: "assistant",
        content:
          "I ran an internal tool to answer your question, but it didn't return any readable reply. Please try asking again in a slightly different way."
      };

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, fallbackMessage],
        choices: []
      });
    }

    // ─────────────────────────────────────────────
    // Plain LLM message (no tool calls)
    // ─────────────────────────────────────────────
    const finalMessage: AgentMessage = {
      role: "assistant",
      content: msg.content || ""
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
