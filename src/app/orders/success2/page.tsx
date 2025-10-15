// src/app/orders/success2/page.tsx
import Script from "next/script";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

function toGBP(cents?: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(
    cents / 100
  );
}

type SP = { [k: string]: string | string[] | undefined };

export default async function Receipt({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  const orderId =
    (Array.isArray(sp.orderId) ? sp.orderId[0] : sp.orderId) ||
    (Array.isArray(sp.id) ? sp.id[0] : sp.id) ||
    "";
  const s =
    (Array.isArray(sp.s) ? sp.s[0] : sp.s) ||
    (Array.isArray(sp.token) ? sp.token[0] : sp.token) ||
    "";

  if (!orderId || !s) {
    return (
      <div className="ps-theme min-h-screen bg-app text-app">
        {/* Brand theme (plain <style>, not styled-jsx) */}
        <style>{`
          .ps-theme{
            --bg:#0f1a2a;
            --card:#1a2a45;
            --border:#233754;
            --text:#eaf2ff;
            --muted:#a9b6cc;
            --link:#8fb6ff;
            --radius:14px;
            --shadow:0 6px 20px rgba(0,0,0,.25);
          }
          .bg-app{ background:var(--bg); }
          .text-app{ color:var(--text); }

          /* Remap common classes to dark palette */
          .ps-theme .bg-white{ background-color:var(--card)!important; }
          .ps-theme .border{ border-color:var(--border)!important; }
          .ps-theme .text-slate-600,
          .ps-theme .text-gray-600,
          .ps-theme .text-neutral-600{ color:var(--muted)!important; }
          .ps-theme h1, .ps-theme .font-bold, .ps-theme .font-semibold { color: var(--text); }
          .ps-theme a{ color:var(--link); }
          .ps-theme .rounded-2xl{ border-radius: var(--radius); }
          .ps-theme .shadow{ box-shadow: var(--shadow); }
          .ps-theme hr{ border-color: var(--border); }
        `}</style>

        <main className="mx-auto max-w-3xl p-6">
          <h1 className="text-2xl font-bold">Pace Shuttles</h1>
          <p className="mt-6 text-red-600">Missing order info.</p>
        </main>
      </div>
    );
  }

  // Server Supabase client
  const jar = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => jar.get(name)?.value,
        set: (name, value, options) => jar.set(name, value, options),
        remove: (name, options) => jar.set(name, "", { ...options, maxAge: 0 }),
      },
    }
  );

  // Only the fields we actually need to render + compute totals
  const { data: order, error } = await supabase
    .from("orders")
    .select(
      "id, qty, journey_date, unit_price_cents, total_cents, tax_rate, fees_rate, success_token"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order || order.success_token !== s) {
    return (
      <div className="ps-theme min-h-screen bg-app text-app">
        <style>{`
          .ps-theme{
            --bg:#0f1a2a;
            --card:#1a2a45;
            --border:#233754;
            --text:#eaf2ff;
            --muted:#a9b6cc;
            --link:#8fb6ff;
            --radius:14px;
            --shadow:0 6px 20px rgba(0,0,0,.25);
          }
          .bg-app{ background:var(--bg); }
          .text-app{ color:var(--text); }
          .ps-theme .bg-white{ background-color:var(--card)!important; }
          .ps-theme .border{ border-color:var(--border)!important; }
          .ps-theme .text-slate-600,
          .ps-theme .text-gray-600,
          .ps-theme .text-neutral-600{ color:var(--muted)!important; }
          .ps-theme h1, .ps-theme .font-bold, .ps-theme .font-semibold { color: var(--text); }
          .ps-theme a{ color:var(--link); }
          .ps-theme .rounded-2xl{ border-radius: var(--radius); }
          .ps-theme .shadow{ box-shadow: var(--shadow); }
          .ps-theme hr{ border-color: var(--border); }
        `}</style>

        <main className="mx-auto max-w-3xl p-6">
          <h1 className="text-2xl font-bold">Pace Shuttles</h1>
          <p className="mt-6 text-red-600">Order not found or token mismatch.</p>
        </main>
      </div>
    );
  }

  // Ensure numeric, sane defaults
  const qty = Math.max(1, Number(order.qty ?? 1));
  const taxRate = Number(order.tax_rate ?? 0);
  const feesRate = Number(order.fees_rate ?? 0);

  // Per-seat all-in (in cents). If somehow absent, fall back from total.
  const unitC =
    typeof order.unit_price_cents === "number" && Number.isFinite(order.unit_price_cents)
      ? order.unit_price_cents
      : Math.round(Number(order.total_cents ?? 0) / qty);

  // Decompose per-seat all-in into base/tax/fees using the compounded model.
  // We keep cents throughout and let fees be the balancing remainder to avoid rounding drift.
  const denom = 1 + taxRate + feesRate + taxRate * feesRate;
  const basePerC = denom ? Math.round(unitC / denom) : 0;
  const taxPerC = Math.round(basePerC * taxRate);
  const feesPerC = unitC - basePerC - taxPerC; // penny-accurate remainder

  // ORDER TOTALS (multiply by qty)
  const baseTotalC = basePerC * qty;
  const taxTotalC = taxPerC * qty;
  const feesTotalC = feesPerC * qty;

  // Print helper (auto-print when ?print=1)
  const printUrl = `/orders/success2?orderId=${encodeURIComponent(order.id)}&s=${encodeURIComponent(
    order.success_token
  )}&print=1`;

  return (
    <div className="ps-theme min-h-screen bg-app text-app">
      <style>{`
        .ps-theme{
          --bg:#0f1a2a;
          --card:#1a2a45;
          --border:#233754;
          --text:#eaf2ff;
          --muted:#a9b6cc;
          --link:#8fb6ff;
          --radius:14px;
          --shadow:0 6px 20px rgba(0,0,0,.25);
        }
        .bg-app{ background:var(--bg); }
        .text-app{ color:var(--text); }

        /* Remap common classes to dark palette */
        .ps-theme .bg-white{ background-color:var(--card)!important; }
        .ps-theme .border{ border-color:var(--border)!important; }
        .ps-theme .text-slate-600,
        .ps-theme .text-gray-600,
        .ps-theme .text-neutral-600{ color:var(--muted)!important; }
        .ps-theme h1, .ps-theme .font-bold, .ps-theme .font-semibold { color: var(--text); }
        .ps-theme a{ color:var(--link); }
        .ps-theme .rounded-2xl{ border-radius: var(--radius); }
        .ps-theme .shadow{ box-shadow: var(--shadow); }
        .ps-theme hr{ border-color: var(--border); }

        /* Print button hover contrast on dark */
        .ps-theme a.rounded-xl.bg-black:hover{ background-color: rgba(0,0,0,.85); }
      `}</style>

      <main className="mx-auto max-w-3xl p-6">
        <Script id="print-on-load" strategy="afterInteractive">{`
          (function(){
            try {
              var sp = new URLSearchParams(location.search);
              if (sp.get('print') === '1') setTimeout(function(){ window.print(); }, 50);
            } catch (e) {}
          })();
        `}</Script>

        <h1 className="text-2xl font-bold">Pace Shuttles</h1>

        <section className="mt-6 rounded-2xl border bg-white p-6 shadow">
          <div className="text-xl font-semibold">Payment receipt</div>
          <div className="mt-2 text-sm text-slate-600">
            <div>
              Order ID: <span className="font-mono">{order.id}</span>
            </div>
            <div>
              Travel date:{" "}
              {order.journey_date
                ? new Date(order.journey_date).toLocaleDateString("en-GB")
                : "—"}
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border bg-white p-6 shadow">
          <div className="grid grid-cols-2 items-start">
            <div className="text-lg font-semibold">Seats</div>
            <div className="text-right">{qty}</div>
          </div>

          <hr className="my-4" />

          <div className="grid grid-cols-2 items-center">
            <div>Per seat (incl. tax &amp; fees)</div>
            <div className="text-right">{toGBP(unitC)}</div>
          </div>

          <hr className="my-4" />

          {/* ORDER TOTALS */}
          <div className="grid grid-cols-2 items-center">
            <div>Base (total)</div>
            <div className="text-right">{toGBP(baseTotalC)}</div>
          </div>
          <div className="grid grid-cols-2 items-center">
            <div>Tax (total)</div>
            <div className="text-right">{toGBP(taxTotalC)}</div>
          </div>
          <div className="grid grid-cols-2 items-center">
            <div>Fees (total)</div>
            <div className="text-right">{toGBP(feesTotalC)}</div>
          </div>

          <hr className="my-4" />

          <div className="grid grid-cols-2 items-center">
            <div className="text-lg font-semibold">Total</div>
            <div className="text-right text-lg font-bold">
              {toGBP(order.total_cents ?? unitC * qty)}
            </div>
          </div>

          {/* Print only (Download removed) */}
          <div className="mt-5 flex gap-3 print:hidden">
            <a
              href={printUrl}
              className="rounded-xl bg-black px-4 py-2 text-white hover:bg-black/90"
            >
              Print
            </a>
          </div>
        </section>
      </main>
    </div>
  );
}
