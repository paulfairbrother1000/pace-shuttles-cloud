// src/app/chat/page.tsx
import ChatPanel from "@/components/support/ChatPanel";

export default function ChatPage() {
  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#0f1a2a] text-[#eaf2ff]">
      <section className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-semibold mb-4">Chat</h1>
        <p className="text-sm/6 text-[#a3b3cc] mb-6">
          Ask general questions about routes, journeys, and policies. For booking-specific help, please sign in.
        </p>

        {/* Chat panel sits on the dark page */}
        <ChatPanel />
      </section>
    </main>
  );
}
