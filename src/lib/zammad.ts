// src/lib/zammad.ts
export const ZAMMAD_BASE = "https://pace-shuttles-helpdesk.zammad.com/api/v1";

export function zammadHeaders() {
  const token = process.env.ZAMMAD_API_TOKEN;
  if (!token) throw new Error("ZAMMAD_API_TOKEN is not set");

  return {
    Authorization: `Token token=${token}`,
    "Content-Type": "application/json",
  };
}

/**
 * Your tenant ticket_states:
 *  1 = new
 *  2 = open
 *  6 = pending close  <-- treat as Resolved
 *  4 = closed         <-- Closed (terminal)
 *  5 = merged
 */
export function mapUserStatusByStateId(
  stateId: number
): "open" | "resolved" | "closed" {
  if (stateId === 6) return "resolved";
  if (stateId === 4) return "closed";
  return "open";
}

export async function getTicketCustomerEmail(ticket: any): Promise<string> {
  const customerId = ticket?.customer_id;
  if (!customerId) return "";

  const res = await fetch(`${ZAMMAD_BASE}/users/${customerId}`, {
    headers: zammadHeaders(),
  });
  if (!res.ok) return "";

  const u = await res.json();
  return String(u?.email ?? "").toLowerCase();
}
