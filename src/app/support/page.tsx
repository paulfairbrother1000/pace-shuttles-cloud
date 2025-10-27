// -----------------------------------------------------------------------------
import { Card, CardContent, CardHeader, Button } from "@/src/components/ui/Card";
import { TicketList } from "@/src/components/support/TicketList";
import { getSupabaseServer } from "@/src/lib/supabaseServer";


async function fetchTickets() {
const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/tickets/list`, { cache: "no-store" });
if (!res.ok) return [];
return await res.json();
}


export default async function Page() {
const sb = getSupabaseServer();
const { data: { user } } = await sb.auth.getUser();
if (!user) {
return (
<main className="p-6"><div className="max-w-2xl mx-auto"><Card><CardContent>
<p className="text-sm">Please <a className="text-blue-600 underline" href="/login">sign in</a> to view and create support tickets.</p>
</CardContent></Card></div></main>
);
}
const tickets = await fetchTickets();
return (
<main className="p-4 md:p-6">
<div className="mx-auto max-w-5xl space-y-6">
<div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Support</h1>
<a className="text-sm text-blue-600 underline" href="#create">New ticket</a></div>
<TicketList title="My tickets" tickets={tickets} />
<CreateTicket />
</div>
</main>
);
}


function CreateTicket() {
const [subject, setSubject] = React.useState("");
const [body, setBody] = React.useState("");
const [bookingRef, setBookingRef] = React.useState("");
const [busy, setBusy] = React.useState(false);
const [ok, setOk] = React.useState<string | null>(null);


async function submit() {
setBusy(true); setOk(null);
const res = await fetch("/api/tickets/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userText: body, bookingRef }) });
const data = await res.json();
setBusy(false);
if (res.ok) setOk(`Created #${data.ticketId}`); else setOk(data.error || "Failed");
}


return (
<Card id="create">
<CardHeader><h3 className="font-semibold">Create a ticket</h3></CardHeader>
<CardContent>
<div className="grid gap-3">
<input className="border rounded-xl px-3 py-2 text-sm" placeholder="Subject (optional; auto-generated if blank)" value={subject} onChange={e=>setSubject(e.target.value)} />
<textarea className="border rounded-xl px-3 py-2 text-sm min-h-[120px]" placeholder="Describe the issue or request" value={body} onChange={e=>setBody(e.target.value)} />
<input className="border rounded-xl px-3 py-2 text-sm" placeholder="Booking reference (optional)" value={bookingRef} onChange={e=>setBookingRef(e.target.value)} />
<div className="flex gap-2">
<Button onClick={submit} className="bg-blue-600 text-white border-blue-600 hover:bg-blue-700">{busy?"Submitting…":"Submit"}</Button>
{ok && <span className="text-sm text-gray-600">{ok}</span>}
</div>
</div>
</CardContent>
</Card>
);
}