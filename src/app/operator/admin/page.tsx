// SERVER FILE — do NOT add "use client" here.
// Route Segment Config belongs on the server:
export const dynamic = "force-dynamic";

import Client from "./Client";

export default function Page() {
  return <Client />;
}
