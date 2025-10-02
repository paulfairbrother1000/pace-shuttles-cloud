// src/app/book/confirm/page.tsx
import { Suspense } from "react";
import ConfirmClient from "./ConfirmClient";

// Prevent static/exported prerender for this route segment.
// (This avoids the "useSearchParams requires Suspense" build trap on Vercel.)
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-3xl px-4 py-6">Loading…</div>}>
      <ConfirmClient />
    </Suspense>
  );
}

