import { NextResponse } from "next/server";
import { chatComplete } from "@/lib/ai";
import { preflightGate, systemGuardrails } from "@/lib/guardrails";
import { retrieveSimilar } from "@/lib/rag";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

function isSignedInFromCookies() {
  try {
    const cookieStore = cookies();
    const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const sb = createServerClient(url, anon, {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value; },
        set() {},
        remove() {},
      },
    });
    return sb.auth.getUser().then(({ data }) => !!data?.user ?? false);
  } catch {
    return Promise.resolve(false);
  }
}

export async function POST(req: Request) {
  const { message } = await req.json().catch(() => ({ message: "" }));
  const q = String(message || "").trim();
  if (!q) return NextResponse.json({ content: "Please enter a question." });

  const signedIn = await isSignedInFromCookies();

  // Guardrails preflight
  const gate = preflightGate(q, { signedIn });
  if (gate.action === "deflect" || gate.action === "deny") {
    return NextResponse.json({ content: gate.message });
  }

  // Retrieve knowledge
  const snippets = await retrieveSimilar(q, { signedIn, k: 8 }).catch(() => []);
  const contextBlock =
    snippets.length > 0
      ? snippets.map((s, i) => `【${i + 1}】 ${s.content}`).join("\n\n")
      : "No relevant snippets found.";

  const sys = systemGuardrails({ signedIn });

  const userPrompt = [
    `User question: ${q}`,
    ``,
    `Use the following context snippets (if relevant):`,
    contextBlock,
    ``,
    `Rules:`,
    `- If the question requires live booking/account data and the user is not signed in, kindly ask them to sign in and offer general help.`,
    `- Never disclose operator/captain/crew identities.`,
    `- If context is weak, say what you can and suggest the next step.`,
  ].join("\n");

  const content = await chatComplete([
    { role: "system", content: sys },
    { role: "user", content: userPrompt },
  ]);

  // Optional: short turn summary (for memory later)
  const summary = content.slice(0, 300);

  return NextResponse.json({
    content,
    meta: {
      signedIn,
      usedSnippets: Math.min(snippets.length, 8),
      summary,
    },
  });
}
