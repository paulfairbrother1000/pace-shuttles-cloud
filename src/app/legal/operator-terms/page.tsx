// src/app/legal/operator-terms/page.tsx
export const metadata = {
  title: "Operator Terms & Conditions | Pace Shuttles",
};

const VERSION = "2025-10-10"; // keep in sync with any OPERATOR_TNC_VERSION you use
const UPDATED = "10 October 2025";

/** Small helpers to keep headings consistent */
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

export default function OperatorTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold text-black leading-[1.15]">
          Pace Shuttles — Operator Terms &amp; Conditions
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Version: <strong>{VERSION}</strong> • Last updated: {UPDATED}
        </p>
      </header>

      {/* Intro */}
      <section className="prose prose-neutral max-w-none text-[15px] leading-relaxed">
        <p className="mb-6">
          These Operator Terms &amp; Conditions (“Terms”) govern participation by
          transport operators (“Operator”, “you”) on the Pace Shuttles platform
          (“Platform”). By accepting a journey assignment or connecting your fleet,
          you agree to these Terms.
        </p>
      </section>

      {/* TOC */}
      <nav
        aria-label="Contents"
        className="mb-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-4"
      >
        <H3>What’s inside</H3>
        <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-6 text-sm">
          <li><a className="underline hover:no-underline" href="#who-we-are">1. Parties</a></li>
          <li><a className="underline hover:no-underline" href="#onboarding">2. Onboarding &amp; eligibility</a></li>
          <li><a className="underline hover:no-underline" href="#assignments">3. Assignments &amp; scheduling</a></li>
          <li><a className="underline hover:no-underline" href="#ops">4. Operations &amp; conduct</a></li>
          <li><a className="underline hover:no-underline" href="#safety">5. Safety &amp; compliance</a></li>
          <li><a className="underline hover:no-underline" href="#insurance">6. Insurance</a></li>
          <li><a className="underline hover:no-underline" href="#fees">7. Fees, payouts &amp; taxes</a></li>
          <li><a className="underline hover:no-underline" href="#changes">8. Changes, delays &amp; disruptions</a></li>
          <li><a className="underline hover:no-underline" href="#data">9. Data protection</a></li>
          <li><a className="underline hover:no-underline" href="#brand">10. Branding &amp; marketing</a></li>
          <li><a className="underline hover:no-underline" href="#liability">11. Liability &amp; indemnity</a></li>
          <li><a className="underline hover:no-underline" href="#term">12. Term, suspension &amp; termination</a></li>
          <li><a className="underline hover:no-underline" href="#law">13. Governing law &amp; venue</a></li>
          <li><a className="underline hover:no-underline" href="#general">14. General</a></li>
        </ul>
      </nav>

      <div className="space-y-10 prose prose-neutral max-w-none text-[15px] leading-relaxed">
        {/* 1 */}
        <section>
          <H2 id="who-we-are">1. Parties</H2>
          <p className="mt-3">
            “Pace Shuttles”, “we”, “our”, “us” means <strong>Pace Shuttles IBC</strong>,
            an International Business Corporation registered in <strong>Antigua &amp; Barbuda</strong>.
            “Operator” means the independent carrier or vessel/vehicle owner providing
            the transport service.
          </p>
        </section>

        <hr className="border-neutral-200" />

        {/* 2 */}
        <section>
          <H2 id="onboarding">2. Onboarding &amp; eligibility</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Provide accurate company, fleet, crew and compliance information.</li>
            <li>Maintain all required licences, certifications and permits for the jurisdiction(s) of operation.</li>
            <li>Notify us promptly of any material change (ownership, insurance, safety findings, etc.).</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 3 */}
        <section>
          <H2 id="assignments">3. Assignments &amp; scheduling</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Assignments may be offered via the Platform and include route, date/time, capacity and service notes.</li>
            <li>Accepting an assignment creates a binding obligation to operate the journey according to the manifest and service level.</li>
            <li>If capacity changes or a substitute vessel/vehicle is required, you must seek approval and update the manifest.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 4 */}
        <section>
          <H2 id="ops">4. Operations &amp; conduct</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Arrive in good time for boarding and operate to the published schedule where reasonably possible.</li>
            <li>Ensure crew professionalism and courteous conduct with passengers and counterparties.</li>
            <li>Follow any location-specific terminal/port rules and instructions.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 5 */}
        <section>
          <H2 id="safety">5. Safety &amp; compliance</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Comply with all applicable maritime/road safety regulations and maintain equipment to legal standards.</li>
            <li>Conduct safety briefings and maintain appropriate crew qualifications and rest rules.</li>
            <li>Report incidents immediately and cooperate with any investigation.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 6 */}
        <section>
          <H2 id="insurance">6. Insurance</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Maintain adequate commercial insurance, including passenger liability and hull/vehicle cover, as required by law.</li>
            <li>Provide evidence of insurance upon request and notify us of any lapse or material change.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 7 */}
        <section>
          <H2 id="fees">7. Fees, payouts &amp; taxes</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Payouts are based on the agreed schedule for successfully operated journeys.</li>
            <li>Operators are responsible for all applicable taxes and statutory contributions.</li>
            <li>We may offset bona fide passenger refunds/credits arising from a proven service failure by the Operator.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 8 */}
        <section>
          <H2 id="changes">8. Changes, delays &amp; disruptions</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Inform the Platform and passengers (via provided channels) promptly of any material delay or disruption.</li>
            <li>Use reasonable endeavours to provide an alternative departure or service recovery plan.</li>
            <li>Force majeure events are handled in line with Section 11 (Liability &amp; indemnity) and applicable law.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 9 */}
        <section>
          <H2 id="data">9. Data protection</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Use passenger data only for operating the assigned journey (manifest, safety, and contact as necessary).</li>
            <li>Protect data against unauthorised access and delete it when no longer required by law or operations.</li>
            <li>Comply with applicable data protection laws; notify us of any data incident without undue delay.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 10 */}
        <section>
          <H2 id="brand">10. Branding &amp; marketing</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Use Pace Shuttles branding only as permitted and do not imply partnership or agency beyond these Terms.</li>
            <li>Seek approval for any co-marketing using Pace Shuttles marks or content.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 11 */}
        <section>
          <H2 id="liability">11. Liability &amp; indemnity</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Operator is solely responsible as the carrier for compliance, safety, and lawful operation of the service.</li>
            <li>
              To the maximum extent permitted by law, Pace Shuttles’ aggregate liability to the Operator is limited to
              unpaid, due Platform payouts for the affected journey(s).
            </li>
            <li>Operator shall indemnify Pace Shuttles against claims arising from Operator’s breach, negligence, or misconduct.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 12 */}
        <section>
          <H2 id="term">12. Term, suspension &amp; termination</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>We may suspend or terminate access where safety, compliance or reputational risk is reasonably suspected.</li>
            <li>Either party may terminate for convenience with written notice; accrued rights and obligations survive.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 13 */}
        <section>
          <H2 id="law">13. Governing law &amp; venue</H2>
          <p className="mt-3">
            These Terms are governed by the laws of <strong>Antigua &amp; Barbuda</strong>.
            The parties submit to the exclusive jurisdiction of its courts, subject to any
            agreed dispute escalation process.
          </p>
        </section>

        <hr className="border-neutral-200" />

        {/* 14 */}
        <section>
          <H2 id="general">14. General</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li><strong>Severability:</strong> Invalidity of a clause does not affect the remainder.</li>
            <li><strong>Entire agreement:</strong> These Terms and any written assignment form the entire agreement.</li>
            <li><strong>Assignment:</strong> Neither party may assign without consent, except to an affiliate in good standing.</li>
          </ul>
        </section>

        <section>
          <H2 id="contact">Contact</H2>
          <p className="mt-3">
            Operator support: <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
          </p>
        </section>

        <hr className="border-neutral-200" />

        <p className="text-xs text-neutral-500">
          © {new Date().getFullYear()} Pace Shuttles IBC. All rights reserved.
        </p>
      </div>
    </main>
  );
}
