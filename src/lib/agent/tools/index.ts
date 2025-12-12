// src/lib/agent/tools/index.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentChoice } from "@/lib/agent/agent-schema";

import { catalogTools } from "./catalog";
import { kbTools } from "./searchKB";
import { bookingTools } from "./bookings";
import { quoteTools } from "./quote";
import { destinationsTools } from "./destinations"; // ✅ ADD

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
      name: string; // MUST match ^[a-zA-Z0-9_-]+$
      description: string;
      parameters: any;
    };
  };
  run: (args: any) => Promise<ToolExecutionResult>;
};

export function buildTools(ctx: ToolContext): ToolDefinition[] {
  return [
    ...catalogTools(ctx),
    ...kbTools(ctx),
    ...destinationsTools(ctx), // ✅ ADD (before booking tools is fine)
    ...bookingTools(ctx),
    ...quoteTools(ctx),
  ];
}
