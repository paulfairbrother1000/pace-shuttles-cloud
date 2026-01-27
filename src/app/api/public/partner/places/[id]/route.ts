import { NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}
function safeEqualHex(a: string, b: string) {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const { searchParams } = new URL(req.url);
    const operatorId = searchParams.get("operator_id")?.trim();
    const operatorKey = req.headers.get("x-operator-key")?.trim();

    if (!operatorId) return NextResponse.json({ error: "Missing operator_id" }, { status: 400 });
    if (!operatorKey) return NextResponse.json({ error: "Missing x-operator-key" }, { status: 401 });

    const supabase = createClient(
      must("SUPABASE_URL"),
      must("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false } }
    );

    const { data: operator } = await supabase
      .from("operators")
      .select("partner_api_key_hash")
      .eq("id", operatorId)
      .maybeSingle();

    if (!operator?.partner_api_key_hash) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    const providedHash = sha256Hex(operatorKey);
    if (!safeEqualHex(providedHash, operator.partner_api_key_hash)) {
      return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
    }

    const id = params.id;

const { data: pickup, error: pErr } = await supabase
  .from("pickup_points")
  .select("id, name, picture_url")
  .eq("id", id)
  .eq("active", true)
  .maybeSingle();

    if (pickup) {
      return NextResponse.json({ kind: "pickup", ...pickup });
    }

    const { data: dest } = await supabase
      .from("destinations")
      .select("id, name, picture_url")
      .eq("id", id)
      .maybeSingle();
  
    if (dest) {
      return NextResponse.json({ kind: "destination", ...dest });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
