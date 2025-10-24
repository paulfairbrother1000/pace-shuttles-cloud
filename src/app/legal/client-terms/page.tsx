// src/app/legal/client-terms/page.tsx
export const metadata = {
  title: "Client Terms & Conditions | Pace Shuttles",
};

const VERSION = "2025-10-24";
const UPDATED = "24 October 2025";

/* ---------- Headings ---------- */
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="text-black font-semibold text-xl md:text-2xl leading-tight tracking-tight scroll-mt-24"
    >
      {children}
    </h2>
  );
}
function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-black font-semibold text-lg leading-tight tracking-tight">
      {children}
    </h3>
  );
}

/* ---------- Main ---------- */
export default function ClientTermsPage() {
  return (
    <main className="ps-theme min-h-screen bg-app text-app">
      <style>{`
        .ps-theme{
          --bg:#0f1a2a; --card:#1a2a45; --border:#233754;
          --text:#eaf2ff; --muted:#a9b6cc; --link:#8fb6ff;
          --radius:14px; --shadow:0 6px 20px rgba(0,0,0,.25);
        }
        .bg-app{ background:var(--bg); } .text-app{ color:var(--text); }
        .ps-theme .text-black{ color:var(--text)!important; }
        .ps-theme .text-neutral-600,
        .ps-theme .text-neutral-500{ color:var(--muted)!important; }
        .ps-theme .border-neutral-200{ border-color:var(--border)!important; }
        .ps-theme .bg-neutral-50{ background-color:var(--card)!important; }
        .ps-theme .rounded-2xl{ border-radius:var(--radius); }
        .ps-theme .shadow-card{ box-shadow:var(--shadow); }
        .ps-theme .prose :where(p,li){ color:var(--text); }
        .ps-theme .prose :where(strong){ color:var(--text); font-weight:700; }
        .ps-theme .prose a{ color:var(--link); text-decoration:underline; }
        .ps-theme .prose a:hover{ text-decoration:none; }
        .ps-theme nav[aria-label="Contents"] a{ color:var(--link); }
        .ps-theme hr{ border-color:var(--border); }
        .ps-theme .marker\\:text-neutral-700{
          --tw-text-opacity:1; color:rgba(234,242,255,.7)!important;
        }
      `}</style>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold text-black leading-[1.15]">
            Pace Shuttles — Client Terms &amp; Conditions
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Version: <strong>{VERSION}</strong> • Last updated: {UPDATED}
          </p>
        </header>

        <section className="prose prose-neutral max-w-none text-[15px] leading-relaxed mb-6">
          <p>
            These Client Terms &amp; Conditions (“Terms”) apply to all bookings made via
            the Pace Shuttles platform. By placing a booking, you confirm that you
            have read, understood, and agree to be bound by these Terms.
          </p>
        </section>

        {/* TOC */}
        <nav
          aria-label="Contents"
          className="mb-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-4 shadow-card"
        >
          <H3>What’s inside</H3>
          <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-6 text-sm">
            <li><a href="#who-we-are">1. Who we are</a></li>
            <li><a href="#our-role">2. Our role (intermediary)</a></li>
            <li><a href="#booking">3. Booking, tickets &amp; manifest</a></li>
            <li><a href="#pricing">4. Pricing &amp; payment</a></li>
            <li><a href="#cancellation">5. Cancellations, rescheduling &amp; refunds</a></li>
            <li><a href="#insurance">6. Insurance, risk &amp; conduct</a></li>
            <li><a href="#disruptions">7. Delays, disruptions &amp; force majeure</a></li>
            <li><a href="#benefits">8. Destination benefits</a></li>
            <li><a href="#data">9. Data &amp; privacy</a></li>
            <li><a href="#support">10. Support &amp; disputes</a></li>
            <li><a href="#liability">11. Liability</a></li>
            <li><a href="#changes">12. Changes to these Terms</a></li>
            <li><a href="#law">13. Governing law &amp; venue</a></li>
            <li><a href="#general">14. General</a></li>
          </ul>
        </nav>

        <div className="space-y-10 prose prose-neutral max-w-none text-[15px] leading-relaxed">
          {/* Sections 1–4 unchanged */}
          <section><H2 id="who-we-are">1. Who we are</H2><p className="mt-3">“Pace Shuttles”, “we”, “our”, and “us” means <strong>Pace Shuttles IBC</strong>, an International Business Corporation registered in <strong>Antigua &amp; Barbuda</strong>. Contact: <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.</p></section>
          <hr className="border-neutral-200" />
          <section><H2 id="our-role">2. Our role (intermediary)</H2><p className="mt-3">Pace Shuttles operates as an <strong>intermediary/booking platform</strong>, not as the transport operator or carrier. Transport services are provided by independent third-party operators (“Operators”). Your contract for carriage is with the Operator named on your booking/manifest, subject to their safety procedures and applicable law.</p></section>
          <hr className="border-neutral-200" />
          <section><H2 id="booking">3. Booking, tickets &amp; manifest accuracy</H2>
            <ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700">
              <li>The person making the booking (“Lead Passenger”) confirms authority for all passengers and that all information supplied is correct.</li>
              <li>Names must match travel documents; incorrect details may result in refusal of boarding.</li>
              <li>Passengers must arrive on time and comply with crew instructions at all times.</li>
            </ul>
          </section>
          <hr className="border-neutral-200" />
          <section><H2 id="pricing">4. Pricing &amp; payment</H2>
            <ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700">
              <li>Prices are per seat and include taxes/fees as displayed at checkout.</li>
              <li>Payments are processed via a secure third-party provider. Pace Shuttles does not store full card details.</li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 5 — updated */}
          <section>
            <H2 id="cancellation">5. Cancellations, rescheduling &amp; refunds</H2>

            <H3 className="mt-3">5A. Cancellation by Client</H3>
            <ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700">
              <li>Clients unable to travel may reschedule the same journey for a new date within <strong>6 months</strong> of the original journey date, subject to seat availability.</li>
              <li>Refunds are administered by <strong>Pace Shuttles IBC</strong> as the booking agent.</li>
              <li><strong>Cancellations made 3+ days (72 hrs or more)</strong> before departure: full refund minus any bank fees incurred by Pace Shuttles.</li>
              <li><strong>Cancellations made 1–3 days (24–72 hrs)</strong> before departure: 50 % cancellation fee applies (50 % refund of booking value).</li>
              <li><strong>Cancellations made less than 24 hrs</strong> before departure: no refund.</li>
              <li>No-shows or late arrivals are treated as travelled; no credit or refund applies.</li>
            </ul>

            <H3 className="mt-6">5B. Cancellation by Operator</H3>
            <ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700">
              <li>If an Operator must cancel a journey, Pace Shuttles will make every reasonable effort to re-allocate you to another provider for the same journey time and destination.</li>
              <li>If re-allocation is not possible, you will be offered one of the following:
                <ul className="list-disc pl-5 mt-2 space-y-1">
                  <li>Reschedule for a different journey time on the same route;</li>
                  <li>Where the Operator lacks minimum yield, you may opt to pay the balance to guarantee departure (no further bookings added after payment); or</li>
                  <li>Receive a full refund.</li>
                </ul>
              </li>
              <li>If you fail to respond to cancellation notifications within 24 hours of the scheduled journey, your booking will be automatically cancelled and fully refunded.</li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 6 onward unchanged except Section 7 tweak */}
          <section>
            <H2 id="insurance">6. Insurance, risk &amp; conduct</H2>
            <ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700">
              <li>Operators maintain appropriate commercial insurance (e.g. passenger liability, vessel/vehicle cover) under local law. Travel is undertaken under the <strong>Operator’s</strong> insurance, not Pace Shuttles’.</li>
              <li>Passengers must follow all crew instructions and safety rules. Dangerous goods or disruptive behaviour may result in refusal of carriage without refund.</li>
              <li>Transporting minors, pets, or special-assistance items is subject to Operator policy and local law.</li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          <section>
            <H2 id="disruptions">7. Delays, disruptions &amp; force majeure</H2>
            <ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700">
              <li>Services may be delayed or disrupted by weather, sea state, mechanical issues, or other factors beyond reasonable control. Journey times are not guaranteed.</li>
              <li>Where feasible, the Operator or Pace Shuttles may offer an alternative departure or reschedule. Refund or reschedule entitlements will follow Section 5.</li>
              <li>Pace Shuttles is not liable for consequential losses such as missed connections or accommodation costs.</li>
            </ul>
          </section>

          {/* Sections 8–14 unchanged from your previous version */}
          <hr className="border-neutral-200" />
          <section><H2 id="benefits">8. Destination benefits &amp; third-party offers</H2><p className="mt-3">Destinations may advertise guest benefits (e.g., a complimentary drink). Such benefits are provided by the destination and subject to their own rules. Pace Shuttles does not guarantee third-party offers.</p></section>
          <hr className="border-neutral-200" />
          <section><H2 id="data">9. Data &amp; privacy</H2><ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700"><li>We share only the data required for your journey: lead passenger contact and manifest names. We do not share data beyond service delivery or legal requirements.</li><li>Payments are handled by our external provider; Pace Shuttles does not store cardholder data.</li><li>Contact <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a> for privacy queries.</li></ul></section>
          <hr className="border-neutral-200" />
          <section><H2 id="support">10. Support &amp; disputes</H2><ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700"><li>For issues, email <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>. We’ll work with you and the Operator to resolve them.</li><li><strong>Dispute escalation:</strong> You agree to seek resolution through Pace Shuttles support before legal action.</li></ul></section>
          <hr className="border-neutral-200" />
          <section><H2 id="liability">11. Liability</H2><ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700"><li>Pace Shuttles’ liability is limited to the total platform fees you paid for the affected booking(s).</li><li>Nothing here limits liability that cannot be excluded by law.</li></ul></section>
          <hr className="border-neutral-200" />
          <section><H2 id="changes">12. Changes to these Terms</H2><p className="mt-3">We may update these Terms periodically. The version shown applies to new bookings from its date. If changes occur between quote and checkout, you may be asked to re-accept the new version.</p></section>
          <hr className="border-neutral-200" />
          <section><H2 id="law">13. Governing law &amp; venue</H2><p className="mt-3">These Terms are governed by the laws of <strong>Antigua &amp; Barbuda</strong>. You submit to the exclusive jurisdiction of its courts, subject to the prior support process in Section 10.</p></section>
          <hr className="border-neutral-200" />
          <section><H2 id="general">14. General</H2><ul className="mt-3 list-disc pl-5 space-y-2 marker:text-neutral-700"><li><strong>Severability:</strong> If any provision is invalid, the rest remain in effect.</li><li><strong>Entire agreement:</strong> These Terms, your booking confirmation, and Operator conditions form the whole agreement.</li><li><strong>Assignment:</strong> You may not assign rights without our written consent.</li></ul></section>

          <section><H2 id="contact">Contact</H2><p className="mt-3">Questions? Email <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.</p></section>
          <hr className="border-neutral-200" />
          <p className="text-xs text-neutral-500">© {new Date().getFullYear()} Pace Shuttles IBC. All rights reserved.</p>
        </div>
      </div>
    </main>
  );
}
