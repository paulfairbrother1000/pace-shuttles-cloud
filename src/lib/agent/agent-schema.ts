export type AgentAction = {
  type: string;
  [key: string]: any;
};

export type AgentChoice = {
  label: string;
  action: AgentAction;
};

export type AgentMessage = {
  role: "assistant" | "user";
  content: string;
  payload?: any;
};

export type AgentResponse = {
  messages: AgentMessage[];
  choices?: AgentChoice[];
};
