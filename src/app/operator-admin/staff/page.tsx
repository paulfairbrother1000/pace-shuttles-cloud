// src/app/operator-admin/staff/page.tsx
export const revalidate = 0;
export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";
export const prerender = false;

import StaffTilesClient from "./StaffTilesClient";

export default function Page() {
  return <StaffTilesClient />;
}
