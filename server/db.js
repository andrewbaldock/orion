// Orion database layer — bun:sqlite.
// Design rule #1: NOTHING is ever deleted. Listings are upserted by a stable
// key so the agent can refresh them hourly without ever clobbering the fields
// YOU own (status, notes, hidden, pinned). Old/expired listings just stop
// being "last_seen" — they stay in your history forever.

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/orion.db";
mkdirSync(dirname(DB_PATH), { recursive: true });
// Config export the discovery agent reads (same dir as the DB / incoming.jsonl).
const AGENT_CONFIG_PATH = join(dirname(DB_PATH), "agent-config.json");

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
// Wait up to 5s on a locked DB instead of erroring immediately — de-risks any
// write contention between the always-on API and a concurrent importer.
db.exec("PRAGMA busy_timeout = 5000;");

// --- Schema -----------------------------------------------------------------
// Application pipeline stages. Higher rank = further along.
export const STATUSES = [
  "new",         // freshly discovered / slurped
  "interested",  // you flagged it
  "applied",
  "phone_screen",
  "interview",
  "offer",
  "rejected",    // they passed on you
  "passed",      // YOU passed / tried / not interested -> sinks to bottom
];

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key    TEXT UNIQUE NOT NULL,   -- canonical url, else hash of company+title
  url           TEXT,
  title         TEXT,
  company       TEXT,
  location      TEXT,
  work_mode     TEXT,                   -- remote | hybrid | onsite | unknown
  salary        TEXT,
  description   TEXT,
  source        TEXT,                   -- linkedin | hn | indeed | uc | gov | manual | ...
  employer_type TEXT,                   -- company | uc | government
  -- scoring (recomputed by the agent; never overwrites user fields below)
  score         REAL DEFAULT 0,
  score_reasons TEXT,                   -- JSON array of strings
  health_flag   TEXT DEFAULT 'ok',      -- ok | concern | excluded
  health_score  INTEGER,                -- 1 (failing) .. 10 (rock solid); null = unknown
  health_notes  TEXT,
  fit_summary   TEXT,                   -- agent's one-line "why this is a fit" blurb
  posted_at     TEXT,                   -- when the role was posted at the source (if known)
  -- USER-OWNED fields. The agent must preserve these on refresh.
  status        TEXT DEFAULT 'new',
  hidden        INTEGER DEFAULT 0,      -- send to bottom / don't show again
  pinned        INTEGER DEFAULT 0,
  notes         TEXT,
  -- timestamps
  first_seen_at TEXT DEFAULT (datetime('now')),
  last_seen_at  TEXT DEFAULT (datetime('now')),
  applied_at    TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now')),
  raw_json      TEXT                    -- full payload as slurped/discovered
);

CREATE TABLE IF NOT EXISTS status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT UNIQUE NOT NULL,
  url         TEXT,
  discovered_at TEXT DEFAULT (datetime('now')),
  active      INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,           -- JSON
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_hidden  ON jobs(hidden);
CREATE INDEX IF NOT EXISTS idx_jobs_score   ON jobs(score);
`);

// --- Additive migrations ----------------------------------------------------
// New scalar fields get a real column added in place; `CREATE TABLE IF NOT EXISTS`
// alone won't touch an existing DB. This is how we add "columns" over time without
// breaking old rows (anything ad-hoc still rides in raw_json). Idempotent.
function ensureColumn(table, column, decl) {
  const cols = db.query(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}
ensureColumn("jobs", "health_score", "INTEGER");
ensureColumn("jobs", "fit_summary", "TEXT"); // agent's one-line "why this is a fit"
ensureColumn("jobs", "posted_at", "TEXT");   // when the role was POSTED (source date), if known

// --- Settings / search configuration ----------------------------------------
// Everything the search + scoring uses is configurable here and editable from
// the Settings page. The hourly agent reads this config each run, so changing
// it changes what gets hunted — no code edits needed.
export const DEFAULT_SETTINGS = {
  searchProfile: {
    keywords: ["react", "frontend", "front-end", "javascript", "css", "less"],
    excludeKeywords: ["contract", "unpaid"],
    locations: { bayAreaHybridOnsite: true, usRemote: true },
    bayAreaCities: [
      "San Francisco", "Oakland", "Berkeley", "Palo Alto", "Mountain View",
      "San Jose", "Santa Clara", "Sunnyvale", "San Mateo", "Santa Cruz",
    ],
  },
  priorityEmployers: {
    uc: ["UC Berkeley", "UCSF", "UC Santa Cruz"],
    government: true,
  },
  excludeStrugglingCompanies: true,
  // New-job alert behavior (frontend favicon blink/title flash + the "hot" threshold).
  alerts: { hotJobBlink: true, flashTitle: true, hotScore: 60 },
  sources: [
    { name: "LinkedIn", url: "https://www.linkedin.com/jobs/", active: true },
    { name: "Hacker News Who's Hiring", url: "https://hnhiring.com/", active: true },
    { name: "Indeed", url: "https://www.indeed.com/", active: true },
    { name: "Built In SF", url: "https://www.builtinsf.com/", active: true },
    { name: "Wellfound", url: "https://wellfound.com/", active: true },
    { name: "Arc.dev", url: "https://arc.dev/remote-jobs/reactjs", active: true },
    { name: "ReactJobs.io", url: "https://reactjobs.io/", active: true },
    { name: "UC systemwide", url: "https://careerspub.universityofcalifornia.edu/", active: true },
    { name: "UCSF Careers", url: "https://ucsf.wd5.myworkdayjobs.com/UCSF_Jobs", active: true },
    { name: "UC Santa Cruz", url: "https://careers.ucsc.edu/", active: true },
    { name: "SF Gov Careers", url: "https://careers.sf.gov/", active: true },
    { name: "CalCareers", url: "https://www.calcareers.ca.gov/", active: true },
  ],
  agent: { intervalMinutes: 60, maxTopRoles: 8 },
};

export function getSetting(key, fallback = null) {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(key, value) {
  db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(key, JSON.stringify(value));
  return value;
}

export function getConfig() {
  // Merge stored config over defaults so newly-added top-level keys (e.g. `alerts`)
  // appear for existing saved configs without a wipe/migration.
  return { ...DEFAULT_SETTINGS, ...getSetting("config", {}) };
}

export function setConfig(partial) {
  const merged = { ...getConfig(), ...partial };
  setSetting("config", merged);
  writeAgentConfig(merged); // keep the agent's file handoff in sync on every change
  return merged;
}

// Export the config to a flat file the sandboxed discovery agent CAN read (it can't
// reach the API or open orion.db). Mirrors the incoming.jsonl / last_run.json pattern.
// Written on every settings change + once at boot, so Settings edits actually drive
// the hunt (keywords, sources, exclusions, alert threshold).
export function writeAgentConfig(cfg = getConfig()) {
  try {
    writeFileSync(AGENT_CONFIG_PATH, JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.warn("writeAgentConfig failed:", e.message);
  }
}

// Seed defaults on first run.
if (!db.query("SELECT 1 FROM settings WHERE key = 'config'").get()) {
  setSetting("config", DEFAULT_SETTINGS);
}

// Export the config at boot so data/agent-config.json always exists for the agent
// (covers existing DBs that were seeded before the export path existed).
writeAgentConfig();

// --- Helpers ----------------------------------------------------------------

export function nowISO() {
  return new Date().toISOString();
}

/**
 * Insert a discovered/slurped job, or refresh an existing one WITHOUT touching
 * user-owned fields. Returns { job, created }.
 */
export function upsertJob(payload) {
  const key = payload.dedupe_key || payload.url || hashKey(payload);
  const existing = db.query("SELECT * FROM jobs WHERE dedupe_key = ?").get(key);

  if (existing) {
    db.query(
      `UPDATE jobs SET
         url = COALESCE(?, url),
         title = COALESCE(?, title),
         company = COALESCE(?, company),
         location = COALESCE(?, location),
         work_mode = COALESCE(?, work_mode),
         salary = COALESCE(?, salary),
         description = COALESCE(?, description),
         source = COALESCE(?, source),
         employer_type = COALESCE(?, employer_type),
         score = ?,
         score_reasons = ?,
         health_flag = COALESCE(?, health_flag),
         health_score = COALESCE(?, health_score),
         health_notes = COALESCE(?, health_notes),
         fit_summary = COALESCE(?, fit_summary),
         posted_at = COALESCE(?, posted_at),
         last_seen_at = datetime('now'),
         updated_at = datetime('now'),
         raw_json = COALESCE(?, raw_json)
       WHERE dedupe_key = ?`
    ).run(
      payload.url ?? null, payload.title ?? null, payload.company ?? null,
      payload.location ?? null, payload.work_mode ?? null, payload.salary ?? null,
      payload.description ?? null, payload.source ?? null, payload.employer_type ?? null,
      payload.score ?? existing.score, JSON.stringify(payload.score_reasons ?? []),
      payload.health_flag ?? null, payload.health_score ?? null, payload.health_notes ?? null,
      payload.fit_summary ?? null, payload.posted_at ?? null,
      payload.raw_json ? JSON.stringify(payload.raw_json) : null, key
    );
    return { job: getJob(existing.id), created: false };
  }

  const info = db.query(
    `INSERT INTO jobs
       (dedupe_key, url, title, company, location, work_mode, salary, description,
        source, employer_type, score, score_reasons, health_flag, health_score, health_notes,
        fit_summary, posted_at, raw_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    key, payload.url ?? null, payload.title ?? null, payload.company ?? null,
    payload.location ?? null, payload.work_mode ?? null, payload.salary ?? null,
    payload.description ?? null, payload.source ?? "manual", payload.employer_type ?? "company",
    payload.score ?? 0, JSON.stringify(payload.score_reasons ?? []),
    payload.health_flag ?? "ok", payload.health_score ?? null, payload.health_notes ?? null,
    payload.fit_summary ?? null, payload.posted_at ?? null,
    payload.raw_json ? JSON.stringify(payload.raw_json) : null
  );
  return { job: getJob(info.lastInsertRowid), created: true };
}

export function getJob(id) {
  return db.query("SELECT * FROM jobs WHERE id = ?").get(id);
}

export function listJobs({ includeHidden = true, status = null } = {}) {
  let sql = "SELECT * FROM jobs WHERE 1=1";
  const args = [];
  if (!includeHidden) { sql += " AND hidden = 0"; }
  if (status) { sql += " AND status = ?"; args.push(status); }
  // Ranking: pinned first, then active (not hidden / not passed / not rejected),
  // then by score desc, then most-recently-seen.
  sql += `
    ORDER BY
      pinned DESC,
      (hidden = 1 OR status IN ('passed','rejected')) ASC,
      score DESC,
      last_seen_at DESC`;
  return db.query(sql).all(...args);
}

export function updateUserFields(id, fields) {
  const allowed = ["status", "hidden", "pinned", "notes"];
  const sets = [];
  const args = [];
  for (const k of allowed) {
    if (k in fields) { sets.push(`${k} = ?`); args.push(fields[k]); }
  }
  if (fields.status === "applied" && !getJob(id)?.applied_at) {
    sets.push("applied_at = datetime('now')");
  }
  if (!sets.length) return getJob(id);
  sets.push("updated_at = datetime('now')");
  db.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  if ("status" in fields) addStatusHistory(id, fields.status, fields.statusNote);
  return getJob(id);
}

export function addStatusHistory(jobId, status, note = null) {
  db.query("INSERT INTO status_history (job_id, status, note) VALUES (?,?,?)")
    .run(jobId, status, note);
}

export function getStatusHistory(jobId) {
  return db.query(
    "SELECT * FROM status_history WHERE job_id = ? ORDER BY created_at ASC"
  ).all(jobId);
}

export function recordSource(name, url) {
  db.query(
    "INSERT OR IGNORE INTO sources (name, url) VALUES (?, ?)"
  ).run(name, url ?? null);
}

export function listSources() {
  return db.query("SELECT * FROM sources ORDER BY discovered_at DESC").all();
}

export function stats() {
  const byStatus = db.query(
    "SELECT status, COUNT(*) n FROM jobs GROUP BY status"
  ).all();
  const total = db.query("SELECT COUNT(*) n FROM jobs").get().n;
  return { total, byStatus };
}

function hashKey(payload) {
  const s = `${payload.company || ""}|${payload.title || ""}|${payload.location || ""}`
    .toLowerCase();
  // tiny stable hash
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return "k_" + (h >>> 0).toString(36);
}
