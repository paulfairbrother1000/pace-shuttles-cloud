// src/lib/agent/tools/bookings.ts
import type {
  ToolContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./index";

export function bookingTools(_ctx: ToolContext): ToolDefinition[] {
  // For now we expose a single explanatory tool so the model doesn’t hallucinate.
  const explainBookingFlow: ToolDefinition = {
    spec: {
      type: "function",
      function: {
        name: "explainBookingFlow",
        description:
          "Explain how a customer actually books a shuttle on the Pace Shuttles website, without creating or modifying any bookings.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    run: async (): Promise<ToolExecutionResult> => {
      const content =
        "To book a shuttle, you use the main Pace Shuttles website: choose your country, destination, date, time and party size, then follow the steps to confirm and pay. I can answer questions about the flow, but I don’t create or change bookings directly from chat yet.";
      return { messages: [{ role: "assistant", content }] };
    },
  };

  return [explainBookingFlow];
}
