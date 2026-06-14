# Orion ⇄ Discovery Agent — Data Contract

**Audience:** the job-search agent (the Claude desktop routine, "frontend-react-job-tracker")
and Orion's maintainer. This is the **stable interface** between the two. We share this
repo folder (`~/Code/orion`), so this file is how Orion tells the agent what to send.
For free-form back-and-forth, two **directional** logs (so neither side's writes trip
its own file-watcher): **the agent writes `AGENT_LOG.md`; Orion writes `ORION_LOG.md`.**
Each side reads the other's. Append newest-first.

---

## What the agent does each run

1. Search the configured sources for jobs matching Andrew's profile (below).
2. Rate each employer's stability **1–10** using live search context.
3. Write **one JSON object per line** (JSONL) appended to:
   ```
   ~/Code/orion/data/incoming.jsonl
   ```
4. Run the importer:
   ```
   cd ~/Code/orion && bun run import
   ```
   This scores every record with Orion's engine, files it **losslessly** (never
   touching Andrew's status/notes/pins), records new sources, and **truncates the
   file**. Re-runs refresh existing jobs in place (dedupe on `url`, else company+title).
   Nothing is ever lost or duplicated.

**THE agent path — APPEND ONLY (do NOT run `bun run import`):** append your run's JSONL
(jobs + `__source` lines) to `data/incoming.jsonl`. That's plain bytes over the mount —
the sandbox never touches SQLite. A host launchd watcher (`com.orion.import`,
`WatchPaths` on that file) auto-runs the import ON THE HOST, so the macOS host is the
**single DB writer** (no cross-kernel WAL hazard — the sandbox can't reach host
`localhost:3000`, and sandbox-side DB writes risk `-shm`/mmap corruption). Results land
in `data/last_run.json` (same shape) for you to self-check. Write whole newline-
terminated lines.

**Other ingestion paths (not for the sandbox agent):** `POST /api/ingest` (array of
records → run summary) and `POST /api/jobs` (single job) exist for host-side or
networked callers. `PRAGMA busy_timeout=5000` is set. The host watcher uses the same
shared `ingestBatch` path, so scoring/health/dedupe are identical however a record
arrives.

---

## Job object schema (one per line)

```json
{
  "url": "https://…",                  // canonical posting URL — the dedupe key
  "title": "Senior Front-End Engineer",
  "company": "Estuary",
  "location": "Remote (US)",
  "work_mode": "remote",               // remote | hybrid | onsite | unknown
  "salary": "$150k-$175k + equity",    // or null
  "description": "1-2 sentence role summary.",
  "source": "hn",                      // linkedin | hn | indeed | uc | gov | manual | …
  "employer_type": "company",          // company | uc | government
  "health_flag": "ok",                 // ok | concern | excluded
  "health_score": 8,                   // 1 (likely failing) .. 10 (rock solid)
  "health_notes": "VC-backed, post-Series A, dev-first — healthy.",
  "fit_summary": "One rich sentence on why this fits Andrew (shows on the card).",
  "posted_at": "2026-06-10"            // when the SOURCE posted it (ISO date), if known
}
```

New source discovered? Emit:
```json
{"__source": {"name": "Working Nomads", "url": "https://www.workingnomads.com/jobs"}}
```

### Field rules — who does what
- **`url` is REQUIRED and must be canonical + stable (dedupe key).** Always send a
  non-empty `url`. If the source has none (e.g. an HN comment), synthesize a
  deterministic one like `hn://<company>/<slug>` — the SAME job must produce the SAME
  url every run, or it duplicates. (Decided 2026-06-13: dedupe stays URL-based; we did
  NOT switch to company+title hashing.)
- **You (agent) own the employer health rating.** Send `health_score` (1–10),
  `health_flag`, `health_notes`. You have live search context (layoffs, funding,
  runway) that beats Orion re-rating cold — and **if you send `health_score`,
  Orion skips its own Claude call** (saves tokens). Map: 1–3 → `excluded`,
  4–6 → `concern`, 7–10 → `ok`.
- **Orion owns scoring.** It ALWAYS re-scores every record (role match, location/
  remote fit, UC/gov boosts, recency, and a health penalty: `excluded` = −100,
  `concern` = −25). So do NOT send a score — just the facts above.
- **`fit_summary`** = the rich "why it's good" blurb (the prototype's voice).
  Shown prominently on the card.
- **`posted_at`** = the source's post date if you can get it. Orion shows posting
  age ("posted 3 days ago"); without it, it falls back to "seen X ago".
- **`employer_type`**: `uc` for UC schools, `government` for city/county/state
  (both get priority boosts), else `company`. Omitted → Orion guesses.
- Only `title` or `url` is strictly required; the rest is best-effort.

---

## Andrew's candidate profile (encode in search + ratings)

- **Role:** Frontend / React (JavaScript, React, CSS/LESS). TypeScript not required.
- **Location:** SF Bay Area **only if hybrid/onsite**; **anywhere in the US if
  fully remote**. Onsite/hybrid outside the Bay Area is penalized.
- **Priority employers:** UC schools (UC Berkeley, UCSF, UC Santa Cruz) and
  **city/county/state government** (pension/retirement). Boost these.
- **Hard exclusion:** struggling/shaky companies — he's been burned repeatedly.
  Flag self-funded / early-stage / 1099 contract-to-hire / recent-layoff employers
  as `concern` or `excluded` with a note explaining why.

## Sources to search
HN "Who's Hiring", ReactJobs.io, Wellfound, Arc.dev, Working Nomads, Built In SF,
Indeed, LinkedIn, UC systemwide/Berkeley/UCSF/UCSC boards, City & County of SF
(careers.sf.gov), City of Oakland, CalCareers. (Add discoveries via `__source`.)

---

## Versioning
Schema v1 (2026-06-13). If Orion adds/changes a field, it bumps this and notes it
in `AGENT_LOG.md`. New fields are always additive — old JSONL keeps working.
