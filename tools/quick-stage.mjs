// tools/quick-stage.mjs
import fs from "fs";
import path from "path";
import readline from "readline";
import { parse } from "csv-parse/sync";

const CSV = "./storage_images_missing.csv";
const TARGET_BASE = "./supabase/storage/images";

function readCsv(file) {
  const txt = fs.readFileSync(file, "utf8");
  const rows = parse(txt, { columns: true, skip_empty_lines: true });
  // Accept column names "key" or "Key"
  return rows.map(r => r.key || r.Key || r.path || r.Path).filter(Boolean);
}

function ensureDir(p) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}

async function ask(rl, question) {
  return await new Promise(res => rl.question(question, ans => res(ans)));
}

async function main() {
  if (!fs.existsSync(CSV)) {
    console.error(`CSV not found: ${path.resolve(CSV)}`);
    process.exit(1);
  }

  const keys = readCsv(CSV);
  console.log(`Using CSV: ${CSV}`);
  console.log(`Target base: ${TARGET_BASE}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  let staged = 0, skipped = 0;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const dest = path.join(TARGET_BASE, key);
    if (fs.existsSync(dest)) {
      // Already staged; skip quietly
      continue;
    }

    console.log(`[${i + 1}/${keys.length}] Need: ${key}`);
    const src = await ask(rl, "  Drag an image file here (or press Enter to skip): ");

    const trimmed = src.trim();

    if (!trimmed) {
      console.log("  × SKIPPED\n");
      skipped++;
      continue;
    }

    const cleaned = trimmed.replace(/^'|'$/g, "").replace(/^"|"$/g, ""); // remove quotes if Terminal added them

    if (!fs.existsSync(cleaned)) {
      console.log("  ! File not found at that path. Skipping.\n");
      skipped++;
      continue;
    }

    ensureDir(dest);
    fs.copyFileSync(cleaned, dest);
    console.log(`  ✓ Copied to ${dest}\n`);
    staged++;
  }

  rl.close();
  console.log("Done.");
  console.log(`  Staged: ${staged}`);
  console.log(`  Skipped: ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
