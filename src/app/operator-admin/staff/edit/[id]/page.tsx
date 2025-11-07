// src/app/operator-admin/staff/edit/[id]/page.tsx

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";
export const prerender = false;

import StaffEditClient from "./staff-edit-client";

export default function Page() {
  return <StaffEditClient />;
}
