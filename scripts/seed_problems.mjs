#!/usr/bin/env node
// Seed / upsert the `problems` table into a target Supabase project.
//
// Usage:
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
//   node scripts/seed_problems.mjs
//
// Reads scripts/seed_problems.json and UPSERTs every row via the REST API
// using `Prefer: resolution=merge-duplicates` (conflict on primary key `id`).
// Idempotent: safe to re-run. Never hardcodes credentials.
//
// NOTE: the service_role key bypasses RLS. Run this only from a trusted local
// shell against a Supabase project you control. Do not commit the key.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_FILE = join(__dirname, "seed_problems.json");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!SUPABASE_URL) {
  fail(
    "SUPABASE_URL is not set. Export it, e.g.\n" +
      "  export SUPABASE_URL=https://<project-ref>.supabase.co"
  );
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Export it (do NOT hardcode / commit it):\n" +
      "  export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>"
  );
}

const REST = `${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/problems`;

async function main() {
  let rows;
  try {
    rows = JSON.parse(await readFile(SEED_FILE, "utf8"));
  } catch (e) {
    fail(`could not read/parse ${SEED_FILE}: ${e.message}`);
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    fail(`${SEED_FILE} contained no rows`);
  }

  console.log(`Upserting ${rows.length} problems into ${SUPABASE_URL} ...\n`);

  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const res = await fetch(REST, {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          // Upsert on primary key conflict; don't return the row body.
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      });

      if (res.ok) {
        ok++;
        console.log(`  ok   ${row.id}`);
      } else {
        failed++;
        const detail = (await res.text()).slice(0, 300);
        console.log(`  FAIL ${row.id}  [HTTP ${res.status}] ${detail}`);
      }
    } catch (e) {
      failed++;
      console.log(`  FAIL ${row.id}  ${e.message}`);
    }
  }

  console.log(
    `\nDone. ${ok} ok, ${failed} failed, ${rows.length} total.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
