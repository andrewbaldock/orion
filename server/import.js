// Importer for the hourly discovery agent.
//
// The scheduled agent appends one JSON object per line to data/incoming.jsonl
// (lossless, append-only). This script reads new lines, scores + upserts each
// job, records any newly discovered sources, then truncates the file.
//
// Run manually:   bun run import
// Or POST the same payloads to /api/jobs while the server is running.

import { ingestBatch } from "./ingest.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const INCOMING = process.env.INCOMING_PATH || "./data/incoming.jsonl";

export async function importIncoming(path = INCOMING) {
  const summaryPath = join(dirname(path), "last_run.json");
  const noop = { ran_at: new Date().toISOString(), imported: 0, created: 0, updated: 0, sources: 0, skipped: 0, errors: [] };

  // Nothing to do. Do NOT overwrite last_run.json — the WatchPaths watcher re-fires
  // on the just-truncated file, and clobbering the real summary with zeros would
  // confuse the agent's self-check. Preserve the last meaningful run.
  if (!existsSync(path)) { console.log("No incoming file at", path); return noop; }

  // Parse JSONL → records, tracking parse failures as skips.
  const rawLines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  if (rawLines.length === 0) { console.log("Incoming file empty — nothing to import."); return noop; }
  const records = [];
  const parseErrors = [];
  for (let i = 0; i < rawLines.length; i++) {
    try { records.push(JSON.parse(rawLines[i])); }
    catch { parseErrors.push({ line: i + 1, error: "invalid JSON", snippet: rawLines[i].slice(0, 80) }); }
  }

  // Shared ingest path (also used by POST /api/ingest).
  const res = await ingestBatch(records);
  writeFileSync(path, ""); // truncate after successful import (lossless: rows live in the DB)

  const summary = {
    ran_at: new Date().toISOString(),
    imported: rawLines.length,
    created: res.created, updated: res.updated, sources: res.sources,
    skipped: res.skipped + parseErrors.length,
    errors: [...parseErrors, ...res.errors],
  };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(
    `Imported ${summary.imported} records → ${summary.created} new, ${summary.updated} refreshed, ` +
    `${summary.sources} sources, ${summary.skipped} skipped${summary.errors.length ? ` (${summary.errors.length} errors)` : ""}.`
  );
  return summary;
}

if (import.meta.main) await importIncoming();
