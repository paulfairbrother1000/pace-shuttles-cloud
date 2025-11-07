"use client";

export const prerender = false;
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "default-no-store";

import { useParams, useRouter } from "next/navigation";
import { useMemo } from "react";

export default function StaffEditStub() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const isNew = useMemo(() => id === "new", [id]);

  return (
    <div className="p-4 space-y-4">
      <button
        className="rounded-full border px-3 py-1.5 text-sm"
        onClick={() => router.push("/operator-admin/staff")}
      >
        ← Back
      </button>
      <h1 className="text-2xl font-semibold">
        {isNew ? "New Staff (stub)" : "Edit Staff (stub)"}
      </h1>
      <p className="text-neutral-600">
        This is a temporary, safe placeholder to keep builds and navigation stable while the full editor is rebuilt.
      </p>
    </div>
  );
}
