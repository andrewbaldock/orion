// The single ingestion choke point: every job — whether slurped from a URL,
// POSTed manually, or imported from the agent's incoming.jsonl — flows through
// here so they all agree on scoring + health.
//
// Lives in its own module (not index.js) so the importer and tests can use it
// without starting the HTTP server.

import { upsertJob, recordSource, purgeByUrl, getAvoid, jobExistsByKey, isLikedByKey, getConfig } from "./db.js";
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
  // Hard ethics/values block: never store a job from an avoided employer, even if
  // a stale agent run or manual add tries to. Belt-and-suspenders to the agent's
  // own avoid.companies enforcement.
  if (payload.company) {
    const key = payload.company.trim().toLowerCase();
    if (getAvoid().companies.some((c) => c.company.trim().toLowerCase() === key)) {
      return { job: null, created: false, blocked: true };
    }
  }
  if (!payload.employer_type) payload.employer_type = classifyEmployer(payload);

  if (llmEnabled() && payload.company && payload.health_score == null) {
    const h = await lookupHealth(payload.company, payload.description || "");
    if (h) payload = { ...payload, health_flag: h.flag, health_score: h.score, health_notes: h.notes };
  }

  // `liked` is user-owned and never travels in the agent's payload. Pull the
  // existing row's flag in so the +30 boost survives the agent's re-score on
  // refresh. (upsertJob's UPDATE branch never writes `liked`, so this only feeds
  // scoring; the stored flag stays whatever Andrew set.)
  const liked = isLikedByKey(payload.dedupe_key || payload.url);
  // Comp floor is config, not a per-job field — feed it into scoring so the
  // sub-floor penalty applies (the agent reads the same value from agent-config).
  const minSalary = getConfig().searchProfile?.minSalary ?? 0;
  const { score, reasons } = scoreJob({ ...payload, liked, minSalary });
  return upsertJob({ ...payload, score, score_reasons: reasons });
}

// Ingest an array of records (jobs + {"__source":{…}} discovery rows), the same
// logic the file importer and the HTTP /api/ingest endpoint both use. Returns a
// run summary in the shape the agent consumes (matches last_run.json).
export async function ingestBatch(records) {
  let created = 0, updated = 0, sources = 0, skipped = 0, purged = 0;
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec && rec.__source) { recordSource(rec.__source.name, rec.__source.url); sources++; continue; }
    // {"__purge":{"url","reason"}} — agent self-cleans a stale/non-real listing:
    // delete it by url + remember the url so it's never re-added (single-writer safe).
    if (rec && rec.__purge && rec.__purge.url) {
      purgeByUrl(rec.__purge.url, rec.__purge.reason || "agent purge");
      purged++; continue;
    }
    // A record needs a way to identify the row. Normally title/url; but an
    // enrichment/research write-back targets an existing row by dedupe_key (or url)
    // and carries no title — allow those through to upsert (COALESCE updates fields).
    const hasKey = rec && (rec.dedupe_key || rec.url);
    if (!rec || (!rec.title && !hasKey)) { skipped++; errors.push({ line: i + 1, error: "no title, url, or dedupe_key" }); continue; }
    // A titleless record is an enrichment/research write-back — only valid if it
    // targets an EXISTING row. Don't let it INSERT a junk titleless job.
    if (!rec.title && !jobExistsByKey(rec.dedupe_key || rec.url)) {
      skipped++; errors.push({ line: i + 1, error: "enrichment for unknown row (no matching dedupe_key)" }); continue;
    }
    try {
      const { created: isNew, blocked } = await ingest(rec);
      if (blocked) { skipped++; continue; } // avoided employer — silently dropped
      isNew ? created++ : updated++;
    } catch (e) {
      skipped++; errors.push({ line: i + 1, error: String(e?.message || e), snippet: (rec.title || rec.url || "").slice(0, 80) });
    }
  }
  return { imported: records.length, created, updated, sources, skipped, purged, errors };
}
