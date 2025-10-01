// src/app/page.tsx (Server Component)
import Link from "next/link";
import Image from "next/image";
import { supabaseServer } from "@/lib/supabaseServer";

// Safely pick the first non-nullish field from a list of possible keys
function pick<T = any>(row: Record<string, any>, keys: string[]): T | null {
  for (const k of keys) {
    if (row && row[k] != null) return row[k] as T;
  }
  return null;
}

type CountryCard = {
  id: string;
  name: string;
  subtitle: string | null;
  photo: string | null;
  isActive: boolean;
};

export default async function HomePage() {
  // Server-side fetch with service role to avoid anon/RLS issues
  const { data, error } = await supabaseServer
    .from("countries")
    .select("*")
    .order("name");

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 space-y-4">
        <h1 className="text-3xl font-semibold">Plan your shuttle</h1>
        <div className="rounded-xl border bg-red-50 p-4">
          <div className="font-medium text-red-700">Failed to load countries</div>
          <div className="text-sm text-red-700/80 mt-1">{error.message}</div>
        </div>
      </div>
    );
  }

  const rows = (data as Record<string, any>[]) || [];

  const cards: CountryCard[] = rows.map((r) => ({
    id: r.id,
    name: r.name ?? r.country_name ?? "Country",
    subtitle:
      pick<string>(r, ["summary", "description", "subtitle", "tagline", "blurb"]) ??
      null,
    photo:
      pick<string>(r, ["photo_url", "image_url", "image", "cover_url"]) ?? null,
    isActive: r.is_active !== false, // treat missing as active
  }));

  const active = cards.filter((c) => c.isActive);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <h1 className="text-3xl font-semibold">Plan your shuttle</h1>
      <p className="text-neutral-700">
        Filter by country, then transport type, then destination and pick-up — choose
        your date to see the journey summary.
      </p>

      {active.length === 0 ? (
        <div className="rounded-2xl border px-4 py-5 text-neutral-700">
          No countries available yet.
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {active.map((c) => (
            <Link
              key={c.id}
              href={`/countries/${c.id}`}
              className="rounded-2xl border bg-white shadow hover:shadow-md transition"
            >
              <div className="aspect-[16/9] relative overflow-hidden rounded-t-2xl">
                {c.photo ? (
                  <Image src={c.photo} alt={c.name} fill className="object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-neutral-100" />
                )}
              </div>
              <div className="p-4">
                <div className="text-lg font-medium">{c.name}</div>
                {c.subtitle ? (
                  <div className="text-sm text-neutral-600 line-clamp-2 mt-1">
                    {c.subtitle}
                  </div>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
