// The single ingestion choke point: every job — whether slurped from a URL,
// POSTed manually, or imported from the agent's incoming.jsonl — flows through
// here so they all agree on scoring + health.
//
// Lives in its own module (not index.js) so the importer and tests can use it
// without starting the HTTP server.

import { upsertJob, recordSource } from "./db.js";
import { scoreJob } from "./scoring.js";
import { classifyEmployer } from "./slurp.js";
import { llmEnabled, assessEmployerHealth } from "./llm.js";

// Per-company health cache so we make at most one Claude call per employer per
// process run (a call per listing would be wasteful and slow). In-memory is fine
// for the demo; a persisted cache can come later.
const healthCache = new Map();

export async function lookupHealth(company, context = "") {
  if (!company) return null;
  const key = company.trim().toLowerCase();
  if (healthCache.has(key)) return healthCache.get(key);
  const result = await assessEmployerHealth(company, context);
  healthCache.set(key, result);
  return result;
}

export function clearHealthCache(company) {
  if (company) healthCache.delete(company.trim().toLowerCase());
  else healthCache.clear();
}

// Assess health, THEN score, then upsert. Health must come first because
// scoreJob applies the "struggling employer" penalty off health_flag.
//
// Orion ALWAYS runs its own scoring engine on every record, including
// agent/URL-supplied listings — that keeps ranking consistent regardless of
// source. The agent only supplies raw facts + (optionally) a health rating; if
// it provides health_score we trust it and skip our own Claude call (it had
// better web-search context when it found the job, and it saves tokens).
export async function ingest(payload) {
  if (!payload.employer_type) payload.employer_type = classifyEmployer(payload);

  if (llmEnabled() && payload.company && payload.health_score == null) {
    const h = await lookupHealth(payload.company, payload.description || "");
    if (h) payload = { ...payload, health_flag: h.flag, health_score: h.score, health_notes: h.notes };
  }

  const { score, reasons } = scoreJob(payload);
  return upsertJob({ ...payload, score, score_reasons: reasons });
}

// Ingest an array of records (jobs + {"__source":{…}} discovery rows), the same
// logic the file importer and the HTTP /api/ingest endpoint both use. Returns a
// run summary in the shape the agent consumes (matches last_run.json).
export async function ingestBatch(records) {
  let created = 0, updated = 0, sources = 0, skipped = 0;
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec && rec.__source) { recordSource(rec.__source.name, rec.__source.url); sources++; continue; }
    if (!rec || (!rec.title && !rec.url)) { skipped++; errors.push({ line: i + 1, error: "no title or url" }); continue; }
    try {
      const { created: isNew } = await ingest(rec);
      isNew ? created++ : updated++;
    } catch (e) {
      skipped++; errors.push({ line: i + 1, error: String(e?.message || e), snippet: (rec.title || rec.url || "").slice(0, 80) });
    }
  }
  return { imported: records.length, created, updated, sources, skipped, errors };
}
