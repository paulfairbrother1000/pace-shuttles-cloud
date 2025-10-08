"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Passthrough so legacy menu entry keeps working. */
export default function OperatorAdminRoutesPassthrough() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/operator-admin/routes");
  }, [router]);
  return null;
}
