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
  AgentMessage,
  AGENT_SYSTEM_PROMPT
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
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options?: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options?: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
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
    // We don’t need the user object yet, but this ensures auth context is valid.
    await supabase.auth.getUser();

    const baseUrl = getBaseUrl();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

    const tools = buildTools({ baseUrl, supabase });

    // Last user message is the prompt
    const userMessage = body.messages.findLast(m => m.role === "user");
    if (!userMessage) {
      return NextResponse.json({ error: "No user message" }, { status: 400 });
    }

    // Prepend our brand / behaviour system prompt
    const modelMessages: AgentMessage[] = [
      { role: "system", content: AGENT_SYSTEM_PROMPT },
      ...body.messages
    ];

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: modelMessages.map(m => ({
        role: m.role,
        content: m.content,
        name: m.name
      })),
      tools: tools.map(t => t.spec),
      tool_choice: "auto"
    });

    const msg = completion.choices[0]?.message;
    if (!msg) {
      return NextResponse.json(
        { error: "No message returned" },
        { status: 500 }
      );
    }

    // ─────────────────────────────────────────────
    // Handle tool call if requested
    // ─────────────────────────────────────────────
    if (msg.tool_calls?.length) {
      const toolCall = msg.tool_calls[0]; // first tool call only for now
      const impl = tools.find(
        t => t.spec.function.name === toolCall.function.name
      );

      if (!impl) {
        return NextResponse.json<AgentResponse>({
          messages: [
            ...body.messages,
            { role: "assistant", content: `I tried to use a tool called "${toolCall.function.name}", but it isn’t available.` }
          ],
          choices: []
        });
      }

      const args = JSON.parse(toolCall.function.arguments || "{}");
      const result: ToolExecutionResult = await impl.run(args);

      // Tools return ready-to-display assistant messages.
      const toolMessages = result.messages ?? [
        {
          role: "assistant" as const,
          content: "I ran a tool but it didn’t return any messages."
        }
      ];

      return NextResponse.json<AgentResponse>({
        messages: [...body.messages, ...toolMessages],
        choices: result.choices ?? []
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
