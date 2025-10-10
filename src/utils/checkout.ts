// src/utils/checkout.ts
export async function submitCheckout(payload: any) {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  let j: any = null;
  try { j = await res.json(); } catch {}

  if (!res.ok) {
    if (j?.help?.code === "CONSENT_REQUIRED") {
      const el = document.getElementById("client-tnc-consent");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      alert("Please confirm you’ve read the Client Terms & Conditions.");
      return { ok: false, code: "CONSENT_REQUIRED" as const };
    }
    return { ok: false, error: j?.error || "Checkout failed." };
  }

  return { ok: true, data: j };
}
