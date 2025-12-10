// src/app/api/agent/route.ts
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import OpenAI from "openai";
import { cookies, headers } from "next/headers";
import {
  buildTools,
  type ToolExecutionResult,
} from "@/lib/agent/tools";
import {
  AgentRequest,
  AgentResponse,
  AgentMessage,
} from "@/lib/agent/agent-schema";

export const runtime = "nodejs";

// ─────────────────────────────────────────────
// Supabase (server-side user resolution)
// Same idea as before, but using the new
// getAll/setAll cookie interface so it doesn’t
// explode in production.
// ─────────────────────────────────────────────
function getSupabaseClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          // read all cookies from Next’s cookie store
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // write back any cookie updates from Supabase
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // In some runtimes (or error cases) this can fail;
            // swallow silently rather than crashing the agent.
          }
        },
      },
    }
  );
}

// ─────────────────────────────────────────────
// Base URL resolver (prod + local)
// (unchanged)
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
// (same flow as your working version)
// ─────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentRequest;

    const supabase = getSupabaseClient();
    const baseUrl = getBaseUrl();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("[agent] Missing OPENAI_API_KEY");
      return NextResponse.json(
        { error: "Agent not available" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({ apiKey });
    const tools = buildTools({ baseUrl, supabase });

    // Last user message is the prompt
    const userMessage = body.messages.findLast((m) => m.role === "user");
    if (!userMessage) {
      return NextResponse.json(
        { error: "No user message" },
        { status: 400 }
      );
    }

    // Run the agent (unchanged)
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: body.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      tools: tools.map((t) => t.spec),
      tool_choice: "auto",
    });

    const msg = completion.choices[0]?.message;
    if (!msg) {
      return NextResponse.json(
        { error: "No message returned" },
        { status: 500 }
      );
    }

    // ─────────────────────────────────────────
    // Handle tool call if requested
    // (only change is we now pass { baseUrl, supabase })
    // ─────────────────────────────────────────
    if (msg.tool_calls?.length) {
      const toolCall = msg.tool_calls[0]; // first tool call only for now
      const impl = tools.find(
        (t) => t.spec.function.name === toolCall.function.name
      );

      if (!impl) {
        return NextResponse.json({
          content: `Unknown tool: ${toolCall.function.name}`,
        });
      }

      let args: any = {};
      try {
        args = toolCall.function.arguments
          ? JSON.parse(toolCall.function.arguments)
          : {};
      } catch {
        return NextResponse.json({
          content:
            "I had trouble understanding the request for live data. Please try again.",
        });
      }

      const result: ToolExecutionResult = await impl.run(args, {
        baseUrl,
        supabase,
      });

      const toolMessage: AgentMessage = {
        role: "tool",
        name: toolCall.function.name,
        content: JSON.stringify(result),
      };

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, toolMessage, ...(result.messages ?? [])],
        choices: result.choices || [],
      });
    }

    // ─────────────────────────────────────────
    // Plain LLM message
    // (unchanged)
    // ─────────────────────────────────────────
    const finalMessage: AgentMessage = {
      role: "assistant",
      content: msg.content || "",
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
