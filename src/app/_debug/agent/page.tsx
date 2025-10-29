// src/app/_debug/agent/page.tsx
import AgentChat from "@/components/AgentChat";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main className="p-6">
      <AgentChat />
    </main>
  );
}
