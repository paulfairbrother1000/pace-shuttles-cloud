import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";
import { parse } from "csv-parse/sync";
import mime from "mime-types";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

// ====== EDIT THESE TWO IF NEEDED ======
const LOCAL_IMAGES_DIR = path.resolve(process.cwd(), "supabase", "storage", "images"); // where your local emulator files live
const MISSING_CSV = path.resolve(process.cwd(), "storage_images_missing.csv");         // the CSV you exported
// ======================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE || process.env.SERVICE_ROLE;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function readCsv(file) {
  const buf = fs.readFileSync(file);
  return parse(buf, { columns: true, skip_empty_lines: true });
}

async function main() {
  if (!fs.existsSync(MISSING_CSV)) {
    console.error("CSV not found:", MISSING_CSV);
    process.exit(1);
  }
  const rows = readCsv(MISSING_CSV);
  let uploaded = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    const key = row.key || row.KEY || row["key"];
    if (!key) continue;

    const abs = path.join(LOCAL_IMAGES_DIR, key);
    if (!fs.existsSync(abs)) {
      console.warn("Missing locally, skip:", abs);
      skipped++;
      continue;
    }

    const buf = fs.readFileSync(abs);
    const contentType = mime.lookup(abs) || "application/octet-stream";

    // Upload with the exact key; don't overwrite if it already exists
    const { error } = await supabase.storage.from("images").upload(key, buf, {
      contentType,
      upsert: false,
    });

    if (error) {
      if (error.message?.includes("The resource already exists")) {
        console.log("Already exists, skip:", key);
        skipped++;
      } else {
        console.error("Upload failed:", key, error.message);
        failed++;
      }
    } else {
      console.log("Uploaded:", key);
      uploaded++;
    }
  }

  console.log(`\nDone. Uploaded: ${uploaded}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
