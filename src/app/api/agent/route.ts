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
    { cookies: () => cookieStore }
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
      const impl = tools.find(t => t.spec.function?.name === toolCall.function.name);

      if (!impl) {
        return NextResponse.json({
          content: `Unknown tool: ${toolCall.function.name}`
        });
      }

      const args = JSON.parse(toolCall.function.arguments || "{}");
      const result: ToolExecutionResult = await impl.run(args);

      const toolMessage: AgentMessage = {
        role: "tool",
        name: toolCall.function.name,
        content: JSON.stringify(result)
      };

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, toolMessage],
        choices: result.choices || []
      });
    }

    // ─────────────────────────────────────────────
    // Plain LLM message
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
