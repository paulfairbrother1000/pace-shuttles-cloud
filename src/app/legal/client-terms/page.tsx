// src/app/legal/client-terms/page.tsx
export const metadata = {
  title: "Client Terms & Conditions | Pace Shuttles",
};

const VERSION = "2025-10-10"; // keep in sync with CLIENT_TNC_VERSION/NEXT_PUBLIC_CLIENT_TNC_VERSION
const UPDATED = "10 October 2025";

/** Small helpers to keep headings consistent */
function H2({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-black font-semibold text-xl md:text-2xl leading-tight tracking-tight scroll-mt-24"
    >
      {children}
    </h2>
  );
}

function H3({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <h3 className="text-black font-semibold text-lg leading-tight tracking-tight">
      {children}
    </h3>
  );
}

export default function ClientTermsPage() {
  return (
    <main className="ps-theme min-h-screen bg-app text-app">
      {/* --- Pace Shuttles brand theme (scoped) --- */}
      <style jsx global>{`
        .ps-theme{
          --bg:#0f1a2a;            /* page background */
          --card:#1a2a45;          /* tiles / insets */
          --border:#233754;        /* subtle borders */
          --text:#eaf2ff;          /* main text */
          --muted:#a9b6cc;         /* secondary text */
          --link:#8fb6ff;          /* links */
          --radius:14px;
          --shadow:0 6px 20px rgba(0,0,0,.25);
        }
        .bg-app{ background:var(--bg); }
        .text-app{ color:var(--text); }

        /* Remap light classes to dark palette within this page only */
        .ps-theme .text-black{ color:var(--text) !important; }
        .ps-theme .text-neutral-600{ color:var(--muted) !important; }
        .ps-theme .text-neutral-500{ color:var(--muted) !important; }
        .ps-theme .border-neutral-200{ border-color:var(--border) !important; }
        .ps-theme .bg-neutral-50{ background-color:var(--card) !important; }
        .ps-theme .rounded-2xl{ border-radius: var(--radius); }
        .ps-theme .shadow-card{ box-shadow: var(--shadow); }

        /* Prose overrides for dark mode readability */
        .ps-theme .prose :where(p,li){ color: var(--text); }
        .ps-theme .prose :where(strong){ color: var(--text); font-weight: 700; }
        .ps-theme .prose a{ color: var(--link); text-decoration: underline; }
        .ps-theme .prose a:hover{ text-decoration: none; }

        /* TOC list links */
        .ps-theme nav[aria-label="Contents"] a{ color: var(--link); }
        .ps-theme nav[aria-label="Contents"]{ box-shadow: var(--shadow); }

        /* HR line color */
        .ps-theme hr{ border-color: var(--border); }

        /* Lists markers slightly brighter */
        .ps-theme .marker\\:text-neutral-700{ --tw-text-opacity:1; color:rgba(234,242,255,.7)!important; }
      `}</style>

      <div className="mx-auto max-w-3xl px-6 py-8">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl md:text-4xl font-extrabold text-black leading-[1.15]">
            Pace Shuttles — Client Terms &amp; Conditions
          </h1>
          <p className="mt-2 text-sm text-neutral-600">
            Version: <strong>{VERSION}</strong> • Last updated: {UPDATED}
          </p>
        </header>

        {/* Intro */}
        <section className="prose prose-neutral max-w-none text-[15px] leading-relaxed">
          <p className="mb-6">
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
            <li><a className="underline hover:no-underline" href="#who-we-are">1. Who we are</a></li>
            <li><a className="underline hover:no-underline" href="#our-role">2. Our role (intermediary)</a></li>
            <li><a className="underline hover:no-underline" href="#booking">3. Booking, tickets &amp; manifest</a></li>
            <li><a className="underline hover:no-underline" href="#pricing">4. Pricing &amp; payment</a></li>
            <li><a className="underline hover:no-underline" href="#cancellation">5. Cancellations &amp; rescheduling</a></li>
            <li><a className="underline hover:no-underline" href="#insurance">6. Insurance, risk &amp; conduct</a></li>
            <li><a className="underline hover:no-underline" href="#disruptions">7. Delays, disruptions &amp; force majeure</a></li>
            <li><a className="underline hover:no-underline" href="#benefits">8. Destination benefits</a></li>
            <li><a className="underline hover:no-underline" href="#data">9. Data &amp; privacy</a></li>
            <li><a className="underline hover:no-underline" href="#support">10. Support &amp; disputes</a></li>
            <li><a className="underline hover:no-underline" href="#liability">11. Liability</a></li>
            <li><a className="underline hover:no-underline" href="#changes">12. Changes to these Terms</a></li>
            <li><a className="underline hover:no-underline" href="#law">13. Governing law &amp; venue</a></li>
            <li><a className="underline hover:no-underline" href="#general">14. General</a></li>
          </ul>
        </nav>

        <div className="space-y-10 prose prose-neutral max-w-none text-[15px] leading-relaxed">
          {/* 1 */}
          <section>
            <H2 id="who-we-are">1. Who we are</H2>
            <p className="mt-3">
              “Pace Shuttles”, “we”, “our”, and “us” means{" "}
              <strong>Pace Shuttles IBC</strong>, an International Business
              Corporation registered in <strong>Antigua &amp; Barbuda</strong>.
              Contact:{" "}
              <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
            </p>
          </section>

          <hr className="border-neutral-200" />

          {/* 2 */}
          <section>
            <H2 id="our-role">2. Our role (intermediary)</H2>
            <p className="mt-3">
              Pace Shuttles operates as an <strong>intermediary/booking platform</strong>,
              not as the transport operator or carrier. Transport services are provided
              by independent third-party operators (“Operators”). Your contract for
              carriage is with the relevant Operator named on your booking/manifest,
              and carriage is subject to the Operator’s operating rules, safety procedures,
              and applicable law.
            </p>
          </section>

          <hr className="border-neutral-200" />

          {/* 3 */}
          <section>
            <H2 id="booking">3. Booking, tickets &amp; manifest accuracy</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                The person making the booking (“Lead Passenger”) confirms they are
                authorised to act for all passengers named on the manifest and that
                all details provided are true and complete.
              </li>
              <li>
                Names on the manifest must match the travellers. You may be refused
                boarding if details are inaccurate or incomplete.
              </li>
              <li>
                You must arrive in good time for boarding and comply with instructions
                from crew and staff at all times.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 4 */}
          <section>
            <H2 id="pricing">4. Pricing &amp; payment</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                Prices are shown <em>per seat</em> and may include taxes/fees as
                displayed at checkout.
              </li>
              <li>
                Payments are processed by a third-party payment service provider. Pace
                Shuttles does <strong>not</strong> collect, read, or store your full
                card details, billing information, or addresses.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 5 */}
          <section>
            <H2 id="cancellation">5. Cancellations, rescheduling &amp; no-show</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                <strong>No cancellations.</strong> Bookings are non-cancellable and
                non-refundable.
              </li>
              <li>
                <strong>Rescheduling:</strong> you may request to reschedule up to{" "}
                <strong>T-72 (72 hours before departure)</strong>, subject to seat
                availability and operational feasibility, for a new date/time{" "}
                <strong>agreed by all parties within 12 months</strong> of the
                original travel date.
              </li>
              <li>
                Requests inside the T-72 window or failure to present for boarding
                (no-show) are treated as travelled; no credit or reschedule applies.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 6 */}
          <section>
            <H2 id="insurance">6. Insurance, risk &amp; conduct</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                Operators are required to maintain appropriate commercial insurance
                (e.g., passenger liability, vessel/vehicle cover) under applicable
                law. You acknowledge that travel is undertaken under the{" "}
                <strong>Operator’s</strong> insurance and conditions of carriage, not
                Pace Shuttles’.
              </li>
              <li>
                You agree to follow crew instructions and all safety procedures.
                Dangerous goods, unlawful items, and behaviour that risks safety or
                comfort may result in refusal of carriage without refund.
              </li>
              <li>
                The carriage of minors, pets, mobility aids, or special assistance is
                subject to the Operator’s policies and local law; please check in
                advance.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 7 */}
          <section>
            <H2 id="disruptions">7. Delays, disruptions &amp; force majeure</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                Operations may be affected by weather, sea state, mechanical issues,
                port/terminal restrictions, or other factors beyond reasonable control.
                Schedules and journey times are not guaranteed.
              </li>
              <li>
                Where feasible, the Operator or Pace Shuttles may offer an alternative
                departure or reschedule. In all cases, the{" "}
                <strong>no-cancellation policy</strong> applies (see Section 5).
              </li>
              <li>
                Pace Shuttles is not liable for indirect or consequential losses (e.g.
                missed connections, accommodation, or other costs).
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 8 */}
          <section>
            <H2 id="benefits">8. Destination benefits &amp; third-party offers</H2>
            <p className="mt-3">
              From time to time, destinations may advertise guest benefits (e.g., a
              complimentary drink) on the Pace Shuttles website. Such benefits are{" "}
              <strong>provided by the destination</strong> and subject to their
              availability and house rules. Pace Shuttles does not warrant or control
              third-party offers.
            </p>
          </section>

          <hr className="border-neutral-200" />

          {/* 9 */}
          <section>
            <H2 id="data">9. Data &amp; privacy</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                We share only the minimum information necessary to operate your
                journey: Lead Passenger name and contact information, and the
                passenger names required for the manifest. We do not share personal
                data with other third parties except as required to deliver the
                service or by law.
              </li>
              <li>
                Payment data is handled by our external provider; Pace Shuttles does
                not store cardholder data.
              </li>
              <li>
                For more information, contact{" "}
                <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 10 */}
          <section>
            <H2 id="support">10. Support &amp; disputes</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                If you experience an issue, please contact{" "}
                <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>{" "}
                promptly. We will work with you and/or the Operator to resolve it.
              </li>
              <li>
                <strong>Dispute escalation:</strong> You agree to first seek
                resolution via Pace Shuttles support before taking legal action.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 11 */}
          <section>
            <H2 id="liability">11. Liability</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                To the maximum extent permitted by law, Pace Shuttles’ aggregate
                liability to you in connection with these Terms or your use of the
                platform is limited to the total amount of platform fees paid by you
                to Pace Shuttles for the affected booking(s).
              </li>
              <li>
                Nothing in these Terms limits or excludes liability that cannot be
                limited or excluded by applicable law.
              </li>
            </ul>
          </section>

          <hr className="border-neutral-200" />

          {/* 12 */}
          <section>
            <H2 id="changes">12. Changes to these Terms</H2>
            <p className="mt-3">
              We may update these Terms from time to time. The version shown at the
              top applies to new bookings from its published date. If we materially
              change the Terms between quote and checkout, you may be asked to accept
              the new version before proceeding.
            </p>
          </section>

          <hr className="border-neutral-200" />

          {/* 13 */}
          <section>
            <H2 id="law">13. Governing law &amp; venue</H2>
            <p className="mt-3">
              These Terms are governed by the laws of{" "}
              <strong>Antigua &amp; Barbuda</strong>. You submit to the exclusive
              jurisdiction of the courts of Antigua &amp; Barbuda for any dispute
              relating to these Terms, the platform, or your booking, subject to the
              prior support/escalation process in Section 10.
            </p>
          </section>

          <hr className="border-neutral-200" />

          {/* 14 */}
          <section>
            <H2 id="general">14. General</H2>
            <ul className="mt-3 marker:text-neutral-700 list-disc pl-5 space-y-2">
              <li>
                <strong>Severability:</strong> If any provision is found invalid or
                unenforceable, the remaining provisions remain in full force.
              </li>
              <li>
                <strong>Entire agreement:</strong> These Terms, together with your
                booking confirmation and any Operator conditions of carriage, form the
                entire agreement between you and us regarding the booking.
              </li>
              <li>
                <strong>Assignment:</strong> You may not assign or transfer your
                rights without our prior written consent.
              </li>
            </ul>
          </section>

          <section>
            <H2 id="contact">Contact</H2>
            <p className="mt-3">
              Questions? Email{" "}
              <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
            </p>
          </section>

          <hr className="border-neutral-200" />

          {/* Footer */}
          <p className="text-xs text-neutral-500">
            © {new Date().getFullYear()} Pace Shuttles IBC. All rights reserved.
          </p>
        </div>
      </div>
    </main>
  );
}
