// src/app/chat/loading.tsx
export default function Loading() {
  return (
    <main className="min-h-screen p-6">
      <div className="animate-pulse h-8 w-40 rounded bg-neutral-800 mb-4" />
      <div className="animate-pulse h-32 w-full rounded bg-neutral-900" />
    </main>
  );
}
