// /src/app/book/country/CountryPageClient.tsx
"use client";

import { useSearchParams } from "next/navigation";

export default function CountryPageClient() {
  const sp = useSearchParams();
  const countryId = sp.get("id") || sp.get("country") || ""; // whatever keys you expect

  // ...your existing client logic that relied on useSearchParams goes here...
  // e.g., fetch, set state, render tiles, etc.

  return (
    <div>
      {/* render your existing UI using countryId */}
    </div>
  );
}
