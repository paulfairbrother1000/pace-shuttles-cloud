// Unified schema for Chat Agent API
// Used by both frontend (AgentChat) and backend (/api/agent)

export type AgentRole = "user" | "assistant" | "system";

export type AgentMessage = {
  role: AgentRole;
  content: string;
};

// Event payload from button selection
export type AgentEvent = {
  type: string; // e.g. "select_country", "select_destination"
  payload?: Record<string, any>;
};

// A "choice" renders as a button in the UI
export type AgentChoice = {
  id: string;
  label: string;
  payload: AgentEvent;
};

export type AgentRequest = {
  turns: AgentMessage[]; // full message history from the client
  event?: AgentEvent | null;
};

export type AgentResponse = {
  messages: AgentMessage[];
  choices?: AgentChoice[];
  // For future expansion: forms, entity descriptions, actions, etc.
};

// Helper creators
export const msg = (content: string): AgentMessage => ({
  role: "assistant",
  content,
});

export const choice = (
  label: string,
  payload: AgentEvent,
  id = payload.type + "_" + Math.random().toString(36).slice(2)
): AgentChoice => ({
  id,
  label,
  payload,
});
