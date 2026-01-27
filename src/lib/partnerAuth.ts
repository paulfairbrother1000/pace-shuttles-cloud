import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

function must(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sha256Hex(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

export type PartnerOperator = {
  id: string;
  country_id: string | null;
};

export async function requirePartnerOperator(req: Request): Promise<PartnerOperator> {
  const url = new URL(req.url);
  const operatorId = url.searchParams.get("operator_id")?.trim();
  const operatorKey = req.headers.get("x-operator-key")?.trim();

  if (!operatorId) throw Object.assign(new Error("Missing operator_id"), { status: 400 });
  if (!operatorKey) throw Object.assign(new Error("Missing x-operator-key"), { status: 401 });

  const supabase = createClient(
    must("SUPABASE_URL"),
    must("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );

  const { data: operator, error } = await supabase
    .from("operators")
    .select("id, country_id, partner_api_key_hash")
    .eq("id", operatorId)
    .maybeSingle();

  if (error || !operator) throw Object.assign(new Error("Invalid operator_id"), { status: 401 });
  if (!operator.partner_api_key_hash) throw Object.assign(new Error("Operator not enabled for partner API"), { status: 403 });

  const providedHash = sha256Hex(operatorKey);
  if (!safeEqual(providedHash, operator.partner_api_key_hash)) {
    throw Object.assign(new Error("Unauthorised"), { status: 401 });
  }

  return { id: operator.id, country_id: operator.country_id };
}
