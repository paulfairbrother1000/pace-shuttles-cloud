import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { message } = await req.json().catch(() => ({ message: "" }));
  const text = (message || "").toString().toLowerCase();

  // Gate booking-specific queries for anonymous users (UI also shows a sign-in link)
  const bookingLike =
    text.includes("booking") ||
    text.includes("journey") ||
    text.includes("ticket") ||
    text.includes("reservation");

  // Simple, helpful reply without echoing the user's text
  const content = bookingLike
    ? "I can help once you sign in—then I can look up your bookings or journeys. If you just need general info about routes, pickup points, or using the app, ask away!"
    : "Sure—ask me about routes, pickup points, countries we operate in, how to use the app, pricing basics, or booking policies. For account-specific help, please sign in.";

  return NextResponse.json({ content });
}
