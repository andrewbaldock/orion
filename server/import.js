// Importer for the hourly discovery agent.
//
// The scheduled agent appends one JSON object per line to data/incoming.jsonl
// (lossless, append-only). This script reads new lines, scores + upserts each
// job, records any newly discovered sources, then truncates the file.
//
// Run manually:   bun run import
// Or POST the same payloads to /api/jobs while the server is running.

import { recordSource } from "./db.js";
import { ingest } from "./ingest.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const INCOMING = process.env.INCOMING_PATH || "./data/incoming.jsonl";

export async function importIncoming(path = INCOMING) {
  const summaryPath = join(dirname(path), "last_run.json");
  if (!existsSync(path)) {
    console.log("No incoming file at", path);
    const empty = { ran_at: new Date().toISOString(), imported: 0, created: 0, updated: 0, sources: 0, skipped: 0, errors: [] };
    writeFileSync(summaryPath, JSON.stringify(empty, null, 2));
    return empty;
  }
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());
  let created = 0, updated = 0, sources = 0, skipped = 0;
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let rec;
    try { rec = JSON.parse(line); }
    catch { skipped++; errors.push({ line: i + 1, error: "invalid JSON", snippet: line.slice(0, 80) }); continue; }

    // Source-discovery records: {"__source":{"name","url"}}
    if (rec.__source) { recordSource(rec.__source.name, rec.__source.url); sources++; continue; }

    // A real job needs at least a title or a url to be worth keeping.
    if (!rec.title && !rec.url) { skipped++; errors.push({ line: i + 1, error: "no title or url", snippet: line.slice(0, 80) }); continue; }

    // ingest() scores + (optionally) assesses employer health, then upserts
    // losslessly. If the agent already supplied health_score, the Claude call
    // is skipped — so the routine can pre-rate employers to save tokens.
    try {
      const { created: isNew } = await ingest(rec);
      isNew ? created++ : updated++;
    } catch (e) {
      skipped++; errors.push({ line: i + 1, error: String(e?.message || e), snippet: (rec.title || rec.url || "").slice(0, 80) });
    }
  }
  writeFileSync(path, ""); // truncate after successful import (lossless: rows live in the DB)

  // Machine-readable run summary the agent consumes to self-check (shape agreed
  // in AGENT_LOG.md). Always written, even on an empty/error run.
  const summary = { ran_at: new Date().toISOString(), imported: lines.length, created, updated, sources, skipped, errors };
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(
    `Imported ${lines.length} records → ${created} new, ${updated} refreshed, ` +
    `${sources} sources, ${skipped} skipped${errors.length ? ` (${errors.length} errors)` : ""}.`
  );
  return summary;
}

if (import.meta.main) await importIncoming();
