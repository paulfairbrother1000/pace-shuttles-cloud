// src/app/operator/admin/page.tsx
"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import JourneyBoards from "@/components/operator/JourneyBoards";

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Operator = { id: string; name: string | null; logo_url: string | null };
const BUCKET = "images";
const isHTTP = (s?: string | null) => !!s && /^https?:\/\//i.test(s);

async function resolveImageUrl(pathOrUrl: string | null) {
  if (!pathOrUrl) return null;
  if (isHTTP(pathOrUrl)) return pathOrUrl;
  // try public then signed
  const pub = supabase.storage.from(BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
  if (pub) return pub;
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pathOrUrl, 60 * 60 * 24 * 365);
  return data?.signedUrl ?? null;
}

export default function OperatorAdminHome() {
  const [op, setOp] = useState<Operator | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");

  useEffect(() => {
    let off = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const user = sess.session?.user;
      if (!user) return;

      const metaFirst =
        (user.user_metadata?.first_name as string | undefined) ||
        (user.user_metadata?.given_name as string | undefined) ||
        (user.email ? user.email.split("@")[0] : "");
      if (metaFirst) setFirstName(metaFirst);

      // operator_id from cached header or DB
      let operatorId: string | null = null;
      try {
        const cached = JSON.parse(localStorage.getItem("ps_user") || "null");
        operatorId = cached?.operator_id ?? null;
        if (!metaFirst && cached?.first_name) setFirstName(String(cached.first_name));
      } catch {}

      if (!operatorId) {
        const { data } = await supabase
          .from("users")
          .select("operator_id, first_name")
          .eq("id", user.id)
          .maybeSingle();
        operatorId = data?.operator_id ?? null;
        if (!metaFirst && data?.first_name) setFirstName(String(data.first_name));
      }
      if (!operatorId) return;

      // operator row
      const { data: opRow } = await supabase
        .from("operators")
        .select("id,name,logo_url")
        .eq("id", operatorId)
        .maybeSingle();

      if (off) return;
      if (opRow) {
        setOp(opRow as Operator);
        setLogoUrl(await resolveImageUrl(opRow.logo_url ?? null));
      }
    })();
    return () => {
      off = true;
    };
  }, []);

  return (
    <div className="space-y-6 p-4">
      {/* Hero only: logo + operator name */}
      <section className="rounded-2xl border border-neutral-200 bg-white p-6 flex items-center gap-4">
        <div className="h-16 w-16 rounded-full border overflow-hidden bg-neutral-100 flex items-center justify-center">
          {logoUrl ? (
            <img src={logoUrl} alt={op?.name ?? "Operator logo"} className="h-full w-full object-cover" />
          ) : (
            <span className="text-xl font-semibold">
              {(op?.name ?? "A").slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div>
          <h2 className="text-2xl font-semibold">{op?.name ?? "Operator"}</h2>
          {firstName && (
            <p className="text-neutral-600">Welcome, {firstName}! Here’s your snapshot.</p>
          )}
        </div>
      </section>
    </div>
  );



// ...


<JourneyBoards operatorId={view.operator_id} />


}
