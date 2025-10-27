// src/app/chat/error.tsx
"use client";
export default function Error({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="min-h-screen p-6">
      <h1 className="text-xl font-semibold">Chat temporarily unavailable</h1>
      <p className="mt-2 text-sm opacity-80">
        {error?.message || "An unexpected error occurred."}
      </p>
    </main>
  );
}
