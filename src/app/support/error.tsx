"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error("Support route error:", error);
  return (
    <div className="max-w-2xl mx-auto p-6 text-[#eaf2ff]">
      <h2 className="text-xl font-semibold">Support temporarily unavailable</h2>
      <p className="opacity-80 mt-2">
        We hit an error while loading Support{error?.digest ? ` (Digest: ${error.digest})` : ""}.
      </p>
      <button onClick={() => reset()} className="mt-4 px-4 py-2 rounded bg-[#2a6cd6] text-white">
        Try again
      </button>
    </div>
  );
}
