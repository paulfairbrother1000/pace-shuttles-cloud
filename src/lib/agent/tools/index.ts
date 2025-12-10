// src/lib/agent/tools/index.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogTools } from "./catalog";
import { bookingTools } from "./bookings";
import { quoteTools } from "./quote";
import { kbTools } from "./searchKB";
import type { AgentChoice } from "@/lib/agent/agent-schema";

export type ToolExecutionResult = {
  messages?: { role: "assistant"; content: string }[];
  choices?: AgentChoice[];
};

export type ToolContext = {
  baseUrl: string;
  supabase: SupabaseClient;
};

export type ToolDefinition = {
  spec: {
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, any>;
    };
  };
  // NOTE: ctx is closed over when we build the tools – only args are passed at call time.
  run: (args: any) => Promise<ToolExecutionResult>;
};

export function buildTools(ctx: ToolContext): ToolDefinition[] {
  return [
    ...catalogTools(ctx),
    ...bookingTools(ctx),
    ...quoteTools(ctx),
    ...kbTools(ctx),
  ];
}
