// src/app/legal/destination-terms/page.tsx
export const metadata = {
  title: "Destination Partner Terms | Pace Shuttles",
};

const VERSION = "2025-10-10"; // keep in sync with any DESTINATION_TNC_VERSION you use
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

export default function DestinationTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      {/* Header */}
      <header className="mb-8">
        <h1 className="text-3xl md:text-4xl font-extrabold text-black leading-[1.15]">
          Pace Shuttles — Destination Partner Terms
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Version: <strong>{VERSION}</strong> • Last updated: {UPDATED}
        </p>
      </header>

      {/* Intro */}
      <section className="prose prose-neutral max-w-none text-[15px] leading-relaxed">
        <p className="mb-6">
          These Destination Partner Terms (“Terms”) apply to venues, resorts, bars,
          attractions and other hospitality partners (“Destination”, “you”) that
          promote offers to Pace Shuttles guests. By listing an offer or benefit,
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
          <li><a className="underline hover:no-underline" href="#scope">1. Scope</a></li>
          <li><a className="underline hover:no-underline" href="#listing">2. Offers &amp; listings</a></li>
          <li><a className="underline hover:no-underline" href="#redemption">3. Guest redemption</a></li>
          <li><a className="underline hover:no-underline" href="#standards">4. Service standards</a></li>
          <li><a className="underline hover:no-underline" href="#changes">5. Changes &amp; availability</a></li>
          <li><a className="underline hover:no-underline" href="#fees">6. Fees &amp; commercial terms</a></li>
          <li><a className="underline hover:no-underline" href="#brand">7. Branding &amp; marketing</a></li>
          <li><a className="underline hover:no-underline" href="#data">8. Data &amp; privacy</a></li>
          <li><a className="underline hover:no-underline" href="#liability">9. Liability</a></li>
          <li><a className="underline hover:no-underline" href="#term">10. Term &amp; termination</a></li>
          <li><a className="underline hover:no-underline" href="#law">11. Governing law &amp; venue</a></li>
          <li><a className="underline hover:no-underline" href="#general">12. General</a></li>
        </ul>
      </nav>

      <div className="space-y-10 prose prose-neutral max-w-none text-[15px] leading-relaxed">
        {/* 1 */}
        <section>
          <H2 id="scope">1. Scope</H2>
          <p className="mt-3">
            Pace Shuttles lists third-party benefits or promotions offered directly by
            Destinations to Pace guests. We do not guarantee guest traffic or spend,
            and we do not control the Destination premises, policies, or staff.
          </p>
        </section>

        <hr className="border-neutral-200" />

        {/* 2 */}
        <section>
          <H2 id="listing">2. Offers &amp; listings</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Provide clear, truthful offer details (what’s included, limits, opening hours, blackout dates).</li>
            <li>You are responsible for all regulatory compliance (licensing, health &amp; safety, local rules).</li>
            <li>We may edit formatting for clarity but won’t materially alter the offer without your consent.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 3 */}
        <section>
          <H2 id="redemption">3. Guest redemption</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Guests may present booking confirmation or other proof as described in the listing.</li>
            <li>Benefits are provided by the Destination and are subject to house rules and availability.</li>
            <li>We are not a party to transactions between the guest and the Destination beyond listing the offer.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 4 */}
        <section>
          <H2 id="standards">4. Service standards</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Deliver courteous service and honour listed benefits for eligible guests.</li>
            <li>Maintain venue cleanliness, safety and lawful operation at all times.</li>
            <li>Inform us of any incident involving a Pace guest that could affect safety or reputation.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 5 */}
        <section>
          <H2 id="changes">5. Changes, availability &amp; outages</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Notify us promptly of changes, temporary closures, or stock outages that affect the offer.</li>
            <li>We may temporarily hide a listing until accuracy can be restored.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 6 */}
        <section>
          <H2 id="fees">6. Fees &amp; commercial terms</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Any fees, commissions or paid placements will be agreed in writing.</li>
            <li>Destinations are responsible for their taxes and statutory contributions.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 7 */}
        <section>
          <H2 id="brand">7. Branding &amp; marketing</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Use Pace Shuttles branding only as permitted; do not imply partnership beyond these Terms.</li>
            <li>Seek approval for any co-marketing or use of Pace trademarks, images or copy.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 8 */}
        <section>
          <H2 id="data">8. Data &amp; privacy</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Destinations typically receive no personal data from Pace; any data you obtain directly from guests must be handled lawfully.</li>
            <li>Do not add guests to marketing lists without valid consent consistent with applicable law.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 9 */}
        <section>
          <H2 id="liability">9. Liability</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Destinations are solely responsible for their premises, staff, compliance and the fulfilment of listed offers.</li>
            <li>
              To the maximum extent permitted by law, Pace Shuttles’ aggregate liability to the Destination arising out of
              these Terms is limited to any amounts actually paid by the Destination to Pace for the specific promoted listing.
            </li>
            <li>Each party excludes indirect or consequential losses to the extent permitted by law.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 10 */}
        <section>
          <H2 id="term">10. Term &amp; termination</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li>Either party may end a listing with written notice; we may suspend a listing for safety, compliance or accuracy concerns.</li>
            <li>Accrued rights and obligations survive termination.</li>
          </ul>
        </section>

        <hr className="border-neutral-200" />

        {/* 11 */}
        <section>
          <H2 id="law">11. Governing law &amp; venue</H2>
          <p className="mt-3">
            These Terms are governed by the laws of <strong>Antigua &amp; Barbuda</strong>.
            The parties submit to the exclusive jurisdiction of its courts, subject to any
            agreed dispute escalation.
          </p>
        </section>

        <hr className="border-neutral-200" />

        {/* 12 */}
        <section>
          <H2 id="general">12. General</H2>
          <ul className="mt-3 list-disc pl-5 space-y-2">
            <li><strong>Severability:</strong> If any provision is invalid, the remainder stays effective.</li>
            <li><strong>Entire agreement:</strong> These Terms and your listing details form the entire agreement regarding the offer.</li>
            <li><strong>Assignment:</strong> You may not assign without our consent.</li>
          </ul>
        </section>

        <section>
          <H2 id="contact">Contact</H2>
          <p className="mt-3">
            Destination partners: <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
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
