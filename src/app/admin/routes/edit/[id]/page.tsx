// src/app/operator-admin/routes/edit/[id]/page.tsx
import { redirect } from "next/navigation";
export default function Page({ params, searchParams }: { params: { id: string }, searchParams: Record<string,string> }) {
  const q = new URLSearchParams(searchParams).toString();
  const suffix = q ? `?${q}` : "";
  redirect(`/admin/routes/edit/${params.id}${suffix}`);
}
