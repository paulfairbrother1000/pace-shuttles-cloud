// src/lib/agent/tools/searchKB.ts
import type { ToolDefinition, ToolContext } from "./index";
import OpenAI from "openai";

export function kbTools({ supabase }: ToolContext): ToolDefinition[] {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  return [
    {
      spec: {
        type: "function",
        function: {
          name: "search_kb",
          description: "Semantic search KB for FAQs",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string" },
              audience: { type: "string" }
            },
            required: ["query"]
          }
        }
      },
      run: async (args) => {
        const embeddingResp = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: args.query
        });

        const embedding = embeddingResp.data[0].embedding;

        const { data, error } = await supabase.rpc("match_kb_chunks", {
          query_embedding: embedding,
          match_threshold: 0.65,
          audience_filter: args.audience ?? "public",
          match_count: 4
        });

        if (error) throw error;

        const text = data.map((d: any) => d.content).join("\n");

        return {
          messages: [
            {
              role: "assistant",
              content: text || "I couldn’t find anything related to that."
            }
          ]
        };
      }
    }
  ];
}
