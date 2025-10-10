// src/app/legal/client-terms/page.tsx
export const metadata = {
  title: "Client Terms & Conditions | Pace Shuttles",
};

const VERSION = "2025-10-10"; // keep in sync with CLIENT_TNC_VERSION/NEXT_PUBLIC_CLIENT_TNC_VERSION
const UPDATED = "10 October 2025";

export default function ClientTermsPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 prose prose-neutral">
      <h1>Pace Shuttles — Client Terms &amp; Conditions</h1>
      <p className="text-sm text-neutral-600">
        Version: <strong>{VERSION}</strong> • Last updated: {UPDATED}
      </p>

      <p>
        These Client Terms &amp; Conditions (“Terms”) apply to all bookings made
        via the Pace Shuttles platform. By placing a booking, you confirm that
        you have read, understood and agree to be bound by these Terms.
      </p>

      <h2>1. Who we are</h2>
      <p>
        “Pace Shuttles”, “we”, “our”, and “us” means{" "}
        <strong>Pace Shuttles IBC</strong>, an International Business
        Corporation registered in <strong>Antigua &amp; Barbuda</strong>.
        Contact: <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
      </p>

      <h2>2. Our role (intermediary)</h2>
      <p>
        Pace Shuttles operates as an <strong>intermediary/booking platform</strong>,
        not as the transport operator or carrier. Transport services are
        provided by independent third-party operators (“Operators”). Your
        contract for carriage is with the relevant Operator named on your
        booking/manifest, and carriage is subject to the Operator’s operating
        rules, safety procedures and applicable law.
      </p>

      <h2>3. Booking, tickets &amp; manifest accuracy</h2>
      <ul>
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

      <h2>4. Pricing &amp; payment</h2>
      <ul>
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

      <h2>5. Cancellations, rescheduling &amp; no-show</h2>
      <ul>
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

      <h2>6. Insurance, risk &amp; conduct</h2>
      <ul>
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

      <h2>7. Delays, disruptions &amp; force majeure</h2>
      <ul>
        <li>
          Operations may be affected by weather, sea state, mechanical issues,
          port/terminal restrictions, or other factors beyond reasonable
          control. Schedules and journey times are not guaranteed.
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

      <h2>8. Destination benefits &amp; third-party offers</h2>
      <p>
        From time to time, destinations may advertise guest benefits (e.g., a
        complimentary drink) on the Pace Shuttles website. Such benefits are{" "}
        <strong>provided by the destination</strong> and subject to their
        availability and house rules. Pace Shuttles does not warrant or control
        third-party offers.
      </p>

      <h2>9. Data &amp; privacy</h2>
      <ul>
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

      <h2>10. Support &amp; disputes</h2>
      <ul>
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

      <h2>11. Liability</h2>
      <ul>
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

      <h2>12. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. The version shown at the
        top applies to new bookings from its published date. If we materially
        change the Terms between quote and checkout, you may be asked to accept
        the new version before proceeding.
      </p>

      <h2>13. Governing law &amp; venue</h2>
      <p>
        These Terms are governed by the laws of{" "}
        <strong>Antigua &amp; Barbuda</strong>. You submit to the exclusive
        jurisdiction of the courts of Antigua &amp; Barbuda for any dispute
        relating to these Terms, the platform, or your booking, subject to the
        prior support/escalation process in Section 10.
      </p>

      <h2>14. General</h2>
      <ul>
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

      <h2>Contact</h2>
      <p>
        Questions? Email{" "}
        <a href="mailto:hello@paceshuttles.com">hello@paceshuttles.com</a>.
      </p>

      <hr />
      <p className="text-xs text-neutral-500">
        © {new Date().getFullYear()} Pace Shuttles IBC. All rights reserved.
      </p>
    </main>
  );
}
