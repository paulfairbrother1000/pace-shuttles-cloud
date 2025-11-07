// src/app/operator-admin/staff/edit/[id]/staff-edit-client.tsx
"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

const sb =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ? createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
    : null;

type StaffRow = {
  id: string;
  operator_id: string;
  first_name: string;
  last_name: string;
  status: string | null;
  photo_url: string | null;
  licenses: string | null;
  notes: string | null;
  jobrole: string | null;
  type_id: string | null;
  type_ids: string[] | null;
  pronoun: "he" | "she" | "they" | null;
  email: string | null;
};

export default function StaffEditClient() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === "new";

  const [row, setRow] = useState<Partial<StaffRow>>({
    first_name: "",
    last_name: "",
    pronoun: "they",
    status: "Active",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!sb || isNew) return;
    let off = false;
    (async () => {
      const { data, error } = await sb.from("operator_staff").select("*").eq("id", id).single();
      if (off) return;
      if (error) setMsg(error.message);
      else setRow(data as StaffRow);
    })();
    return () => { off = true; };
  }, [id, isNew]);

  async function save() {
    if (!sb) return;
    setSaving(true);
    setMsg(null);
    try {
      if (isNew) {
        const { data, error } = await sb.from("operator_staff").insert({
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          pronoun: row.pronoun || "they",
          status: row.status || "Active",
          operator_id: row.operator_id, // set via RLS/UI later
          jobrole: row.jobrole || null,
          photo_url: row.photo_url || null,
          email: row.email || null,
          type_ids: row.type_ids || null,
          licenses: row.licenses || null,
          notes: row.notes || null,
        }).select("id").single();
        if (error) throw error;
        router.replace(`/operator-admin/staff/edit/${data!.id}`);
      } else {
        const { error } = await sb.from("operator_staff").update({
          first_name: row.first_name || "",
          last_name: row.last_name || "",
          pronoun: row.pronoun || "they",
          status: row.status || "Active",
          operator_id: row.operator_id || null,
          jobrole: row.jobrole || null,
          photo_url: row.photo_url || null,
          email: row.email || null,
          type_ids: row.type_ids || null,
          licenses: row.licenses || null,
          notes: row.notes || null,
        }).eq("id", id);
        if (error) throw error;
      }
    } catch (e: any) {
      setMsg(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <button className="rounded-full border px-3 py-1.5 text-sm" onClick={() => router.push("/operator-admin/staff")}>
        ← Back
      </button>
      <h1 className="text-2xl font-semibold">{isNew ? "New Staff" : "Edit Staff"}</h1>
      {msg && <div className="text-sm text-red-600">{msg}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border p-4 bg-white shadow">
        <label className="text-sm">
          <span className="block text-neutral-600 mb-1">First name</span>
          <input className="w-full border rounded px-3 py-2" value={row.first_name || ""} onChange={(e) => setRow(r => ({ ...r, first_name: e.target.value }))}/>
        </label>
        <label className="text-sm">
          <span className="block text-neutral-600 mb-1">Last name</span>
          <input className="w-full border rounded px-3 py-2" value={row.last_name || ""} onChange={(e) => setRow(r => ({ ...r, last_name: e.target.value }))}/>
        </label>
        <label className="text-sm">
          <span className="block text-neutral-600 mb-1">Pronoun</span>
          <select className="w-full border rounded px-3 py-2" value={row.pronoun || "they"} onChange={(e) => setRow(r => ({ ...r, pronoun: e.target.value as any }))}>
            <option value="they">they</option>
            <option value="he">he</option>
            <option value="she">she</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-neutral-600 mb-1">Status</span>
          <select className="w-full border rounded px-3 py-2" value={row.status || "Active"} onChange={(e) => setRow(r => ({ ...r, status: e.target.value }))}>
            <option>Active</option>
            <option>Inactive</option>
          </select>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="block text-neutral-600 mb-1">Job role</span>
          <input className="w-full border rounded px-3 py-2" value={row.jobrole || ""} onChange={(e) => setRow(r => ({ ...r, jobrole: e.target.value }))}/>
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="block text-neutral-600 mb-1">Notes</span>
          <textarea className="w-full border rounded px-3 py-2" rows={4} value={row.notes || ""} onChange={(e) => setRow(r => ({ ...r, notes: e.target.value }))}/>
        </label>
      </div>

      <button className="rounded-full px-4 py-2 bg-blue-600 text-white disabled:opacity-60" onClick={save} disabled={saving}>
        {isNew ? "Create Staff" : "Save changes"}
      </button>
    </div>
  );
}
