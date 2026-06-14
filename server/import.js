// Importer for the hourly discovery agent.
//
// The scheduled agent appends one JSON object per line to data/incoming.jsonl
// (lossless, append-only). This script reads new lines, scores + upserts each
// job, records any newly discovered sources, then truncates the file.
//
// Run manually:   bun run import
// Or POST the same payloads to /api/jobs while the server is running.

import { recordSource } from "./db.js";
import { ingest } from "./index.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const INCOMING = process.env.INCOMING_PATH || "./data/incoming.jsonl";

export function importIncoming(path = INCOMING) {
  if (!existsSync(path)) {
    console.log("No incoming file at", path);
    return { imported: 0, created: 0 };
  }
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  let created = 0;
  for (const line of lines) {
    let rec;
    try { rec = JSON.parse(line); } catch { continue; }
    if (rec.__source) { recordSource(rec.__source.name, rec.__source.url); continue; }
    const { created: isNew } = ingest(rec);
    if (isNew) created++;
  }
  writeFileSync(path, ""); // truncate after successful import
  console.log(`Imported ${lines.length} records (${created} new).`);
  return { imported: lines.length, created };
}

if (import.meta.main) importIncoming();
