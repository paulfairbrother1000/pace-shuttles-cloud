// src/app/support/error.tsx
"use client";

export default function SupportError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#0f1a2a] text-[#eaf2ff] p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold">Support temporarily unavailable</h1>
        <p className="mt-2 text-sm opacity-80">
          Something went wrong while loading Support.
          {error?.digest ? ` (Digest: ${error.digest})` : ""}
        </p>
        <p className="mt-4 text-sm">
          Please email{" "}
          <a className="underline text-blue-400" href="mailto:hello@paceshuttles.com">
            hello@paceshuttles.com
          </a>{" "}
          and we’ll jump on it.
        </p>
      </div>
    </main>
  );
}
