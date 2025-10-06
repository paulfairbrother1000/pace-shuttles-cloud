"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { publicImage } from "@/lib/publicImage";

type Destination = {
  id: string;
  name: string;
  picture_url?: string | null;
};

const supabase =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
      )
    : null;

export default function AdminDestinationsPage() {
  const [items, setItems] = useState<Destination[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!supabase) return;
      const { data, error } = await supabase
        .from("destinations")
        .select("id,name,picture_url")
        .order("name");
      if (error) setErr(error.message);
      else setItems((data as Destination[]) || []);
    })();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Admin • Destinations</h1>
      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {items.map((dest) => (
          <div key={dest.id} className="rounded-xl border overflow-hidden bg-white">
            <div className="relative aspect-[4/3]">
              <Image
                src={publicImage(dest.picture_url) || "/placeholder.png"}
                alt={dest.name || "Destination"}
                fill
                className="object-cover"
                sizes="250px"
              />
            </div>
            <div className="p-2 text-sm">{dest.name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
