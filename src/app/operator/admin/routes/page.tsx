// src/app/operator/admin/routes/page.tsx
import { redirect } from "next/navigation";

export default function LegacyOperatorAdminRoutesRedirect() {
  // Forward old menu path to the new operator-admin routes tiles
  redirect("/operator-admin/routes");
}
