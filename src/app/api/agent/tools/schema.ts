// Common
export type UUID = string;

// ------------- Public tools -------------
export interface SearchPublicKBInput { query: string; topK?: number; }
export interface SearchPublicKBOutput {
  matches: Array<{ id: string; title: string; section?: string; snippet: string; url?: string; score: number; }>;
}

export interface GetRoutesInput {
  pickup_id?: UUID;
  destination_id?: UUID;
  country_id?: UUID;
  is_active_only?: boolean; // default true
  limit?: number; // default 20
}
export interface GetRoutesOutput {
  routes: Array<{
    id: UUID;
    route_name: string | null;
    pickup_id: UUID | null;
    destination_id: UUID | null;
    duration_mins: number | null;
    next_departure_iso: string | null;
    base_price_gbp: string | null; // stringified numeric to avoid float drift
    transport_type: string | null;
  }>;
}

export interface QuoteInput {
  route_id: UUID;
  date_iso: string;      // YYYY-MM-DD
  seats: number;         // 1+
}
export interface QuoteOutput {
  per_ticket_total_gbp: string; // display rounded UP (done by SSOT)
  breakdown: { base: string; tax: string; fees: string; };
  quoteToken: string;
}

// ------------- Signed-in tools -------------
export interface GetMyBookingsInput { }
export interface GetMyBookingsOutput {
  bookings: Array<{
    id: UUID; booking_ref: string; route_id: UUID; date_iso: string;
    seats: number; status: string; total_gbp: string;
  }>;
}

export interface GetBookingByRefInput { booking_ref: string; }
export interface GetBookingByRefOutput { booking?: GetMyBookingsOutput["bookings"][number]; }

export interface GetMyBalanceInput {}
export interface GetMyBalanceOutput { currency: "GBP"; outstanding_gbp: string; }

export interface GetMyTicketsInput {}
export interface GetMyTicketsOutput {
  tickets: Array<{ id: number | string; subject: string; status: string; updated_at: string; }>;
}

export interface CreateTicketInput {
  subject: string;
  body: string;
  booking_ref?: string;
  category?: string;
}
export interface CreateTicketOutput { ticketId: number | string; url?: string; }

// ------------- Memory tools (safe fields only) -------------
export interface RememberPreferenceInput {
  preferred_pickup_id?: UUID;
  preferred_window?: "morning" | "afternoon" | "evening";
  usual_party_size?: number;
  favourite_destination_id?: UUID;
  prefers_concise?: boolean;
}
export interface RememberPreferenceOutput { ok: true; }

export interface RecallPreferencesInput {}
export interface RecallPreferencesOutput { prefs: RememberPreferenceInput; }
