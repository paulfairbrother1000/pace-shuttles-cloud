// src/app/api/agent/route.ts
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { message, context } = await req.json().catch(() => ({ message: "", context: {} }));
  const signedIn = !!context?.signedIn;

  const content = signedIn
    ? "Great—what booking or journey detail would you like me to look up?"
    : "Sure—ask me about routes, pickup points, countries, or how to use the app. For booking-specific help, please sign in.";
  return NextResponse.json({ content });
}
