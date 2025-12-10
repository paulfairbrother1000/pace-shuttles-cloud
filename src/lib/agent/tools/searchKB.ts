// src/lib/agent/tools/searchKB.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

export function kbTools(ctx: ToolContext): ToolDefinition[] {
  const { baseUrl } = ctx;

  const searchKnowledgeBase: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "searchKnowledgeBase",
        description:
          "Search the Pace Shuttles public knowledge base, including PDFs and terms & conditions, to answer questions about how the service works.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Natural language question to search for in the knowledge base.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    },
    run: async (args: any): Promise<ToolExecutionResult> => {
      const query = String(args.query || "").trim();
      if (!query) {
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I couldn’t understand that well enough to look it up in our documents. Could you rephrase your question?",
            },
          ],
        };
      }

      try {
        const res = await fetch(`${baseUrl}/api/tools/searchPublicKB`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = (await res.json()) as { answer?: string };
        const answer =
          data.answer ||
          "I couldn’t find a precise answer in our public documents, but I can still explain the service at a high level if you’d like.";

        return {
          messages: [
            {
              role: "assistant",
              content: answer,
            },
          ],
        };
      } catch (err) {
        console.error("KB tool error:", err);
        return {
          messages: [
            {
              role: "assistant",
              content:
                "I ran into a problem looking that up in the knowledge base. Please try again in a moment or ask your question in a different way.",
            },
          ],
        };
      }
    },
  };

  return [searchKnowledgeBase];
}
