// -----------------------------------------------------------------------------
// src/app/chat/page.tsx
// -----------------------------------------------------------------------------


import React from "react";
import ChatPanel from "@/src/components/support/ChatPanel";
import { getSupabaseServer } from "@/src/lib/supabaseServer";


export default async function Page() {
const sb = getSupabaseServer();
const { data: { user } } = await sb.auth.getUser();
const authed = !!user;
return (
<main className="p-4 md:p-6">
<div className="mx-auto max-w-5xl">
<h1 className="text-2xl font-semibold mb-4">Chat</h1>
<ChatPanel authed={authed} />
</div>
</main>
);
}