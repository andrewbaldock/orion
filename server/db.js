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
const AGENT_FEEDBACK_PATH = join(dirname(DB_PATH), "agent-feedback.json");

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

-- URLs of postings that were verified dead/closed and purged. Kept so the agent
-- never re-adds them (the only thing we retain from a purged listing).
CREATE TABLE IF NOT EXISTS purged_urls (
  url        TEXT PRIMARY KEY,
  reason     TEXT,
  purged_at  TEXT DEFAULT (datetime('now'))
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
ensureColumn("jobs", "pass_reason", "TEXT"); // user-owned: why Andrew passed (agent learns from it)
ensureColumn("jobs", "pass_category", "TEXT"); // user-owned: ethics|comp|location|seniority|stack|stability|role-type|other
ensureColumn("jobs", "pass_scope", "TEXT");    // user-owned: posting|company|similar
ensureColumn("jobs", "user_overrides", "TEXT"); // JSON {field:value} Andrew hand-edited; agent refresh NEVER clobbers these
ensureColumn("jobs", "research_status", "TEXT DEFAULT 'none'"); // none|requested|done
ensureColumn("jobs", "research_note", "TEXT");  // user-owned: Andrew's research instruction
ensureColumn("jobs", "agent_research", "TEXT"); // agent-owned: findings (markdown)
ensureColumn("jobs", "research_done_at", "TEXT");

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

// --- Avoid rules (ethics/values blocklist) ----------------------------------
// Hard "never show me this employer" + soft "flag roles like this". Stored in
// settings; exported into agent-feedback.json so the discovery agent enforces it.
// Ethics is orthogonal to health_score (stability) and can ONLY come from Andrew.
const DEFAULT_AVOID = { companies: [], patterns: [] };

export function getAvoid() {
  return { ...DEFAULT_AVOID, ...getSetting("avoid", {}) };
}

export function setAvoid(avoid) {
  setSetting("avoid", { ...DEFAULT_AVOID, ...avoid });
  writeAgentFeedback(); // avoid block lives in the feedback export
  return getAvoid();
}

// Add a company to the hard blocklist (idempotent on lowercased name) + purge any
// matching jobs already in the DB so it disappears immediately.
export function addAvoidCompany(company, reason = "", scope = "company") {
  if (!company) return getAvoid();
  const avoid = getAvoid();
  const key = company.trim().toLowerCase();
  if (!avoid.companies.some((c) => c.company.trim().toLowerCase() === key)) {
    avoid.companies.push({ company: company.trim(), reason, scope, added_at: nowISO() });
    setSetting("avoid", avoid);
  }
  // Remove any current rows for this company (records urls so they don't return).
  for (const j of db.query("SELECT id FROM jobs WHERE lower(company) = ?").all(key)) {
    purgeJob(j.id, `avoid: ${reason || "blocked employer"}`);
  }
  writeAgentFeedback();
  return getAvoid();
}

export function removeAvoidCompany(company) {
  const avoid = getAvoid();
  const key = (company || "").trim().toLowerCase();
  avoid.companies = avoid.companies.filter((c) => c.company.trim().toLowerCase() !== key);
  setSetting("avoid", avoid);
  writeAgentFeedback();
  return getAvoid();
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

// Export the jobs Andrew passed/rejected (with his reason) so the agent learns to
// stop surfacing similar roles. Same file-handoff pattern; regenerated whenever a
// status/pass_reason changes + at boot. Empty array when there are none.
export function writeAgentFeedback() {
  try {
    const passed = db.query(
      `SELECT url, company, title, location, work_mode, source, employer_type, status,
              pass_reason, pass_category, pass_scope
       FROM jobs WHERE status IN ('passed','rejected') OR (pass_reason IS NOT NULL AND pass_reason != '')
       ORDER BY updated_at DESC`
    ).all();
    const purgedUrls = db.query("SELECT url, reason, purged_at FROM purged_urls ORDER BY purged_at DESC").all();
    const avoid = getAvoid(); // { companies:[…hard block], patterns:[…soft, mode] }
    // Open research requests Andrew flagged — the agent fulfills these each run.
    const researchRequests = db.query(
      `SELECT url, company, title, research_note, user_overrides
       FROM jobs WHERE research_status = 'requested' ORDER BY updated_at DESC`
    ).all().map(mergeOverrides);
    writeFileSync(AGENT_FEEDBACK_PATH,
      JSON.stringify({ passed, purgedUrls, avoid, researchRequests }, null, 2));
  } catch (e) {
    console.warn("writeAgentFeedback failed:", e.message);
  }
}

// Seed defaults on first run.
if (!db.query("SELECT 1 FROM settings WHERE key = 'config'").get()) {
  setSetting("config", DEFAULT_SETTINGS);
}

// Export the config + feedback at boot so the agent's files always exist
// (covers existing DBs seeded before these export paths existed).
writeAgentConfig();
writeAgentFeedback();

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
         agent_research = COALESCE(?, agent_research),
         research_status = COALESCE(?, research_status),
         research_done_at = COALESCE(?, research_done_at),
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
      payload.agent_research ?? null, payload.research_status ?? null, payload.research_done_at ?? null,
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

// Overlay Andrew's hand-edits (user_overrides JSON) on top of the base row, so his
// massaged values win on read while the agent can still refresh untouched fields.
function mergeOverrides(row) {
  if (!row || !row.user_overrides) return row;
  try {
    const ov = JSON.parse(row.user_overrides);
    return ov && typeof ov === "object" ? { ...row, ...ov } : row;
  } catch { return row; }
}

export function getJob(id) {
  return mergeOverrides(db.query("SELECT * FROM jobs WHERE id = ?").get(id));
}

// Raw row WITHOUT overrides merged — for write paths that need the stored values.
export function getJobRaw(id) {
  return db.query("SELECT * FROM jobs WHERE id = ?").get(id);
}

// Does a row with this dedupe_key (canonical url, else hash) already exist?
export function jobExistsByKey(key) {
  if (!key) return false;
  return !!db.query("SELECT 1 FROM jobs WHERE dedupe_key = ?").get(key);
}

// Purge a closed/dead posting: delete the row AND remember its url so the agent
// never re-adds it. (Per Andrew: closed jobs are purged, not kept/badged. This is
// the one sanctioned exception to "nothing is deleted" — a verified-dead listing
// has no value, and recording the url keeps it from coming back.)
function rememberPurged(url, reason) {
  if (!url) return;
  db.query(
    `INSERT INTO purged_urls (url, reason) VALUES (?, ?)
     ON CONFLICT(url) DO UPDATE SET reason = excluded.reason, purged_at = datetime('now')`
  ).run(url, reason);
}

export function purgeJob(id, reason = null) {
  const job = getJob(id);
  if (!job) return null;
  rememberPurged(job.url, reason);
  db.query("DELETE FROM jobs WHERE id = ?").run(id);
  writeAgentFeedback(); // refresh exports so the agent learns the url is dead
  return job;
}

// Purge by url (used by the {"__purge"} import directive so the agent can self-clean).
export function purgeByUrl(url, reason = null) {
  rememberPurged(url, reason);
  const info = db.query("DELETE FROM jobs WHERE url = ?").run(url);
  writeAgentFeedback();
  return info.changes; // rows deleted (0 if it wasn't in the DB — still remembered)
}

export function listPurgedUrls() {
  return db.query("SELECT url, reason, purged_at FROM purged_urls ORDER BY purged_at DESC").all();
}

export function listJobs({ includeHidden = true, status = null } = {}) {
  let sql = "SELECT * FROM jobs WHERE 1=1";
  const args = [];
  if (!includeHidden) { sql += " AND hidden = 0"; }
  if (status) { sql += " AND status = ?"; args.push(status); }
  // Ranking: pinned first, then active (not hidden / not passed / not rejected),
  // then by score desc, then most-recently-seen. (Closed postings are purged, not
  // ranked — see purgeJob.)
  sql += `
    ORDER BY
      pinned DESC,
      (hidden = 1 OR status IN ('passed','rejected')) ASC,
      score DESC,
      last_seen_at DESC`;
  return db.query(sql).all(...args).map(mergeOverrides);
}

// User-owned columns set directly. (research_status is set here too — by the user
// requesting research; the agent sets it to "done" via ingest.)
const USER_COLUMNS = ["status", "hidden", "pinned", "notes",
  "pass_reason", "pass_category", "pass_scope", "research_status", "research_note"];
// Listing fields Andrew can hand-edit; these are stored in user_overrides (NOT the
// base columns) so the agent's refreshes never clobber his edits.
const OVERRIDE_FIELDS = ["title", "company", "location", "work_mode", "salary",
  "description", "fit_summary", "url", "employer_type", "posted_at"];

export function updateUserFields(id, fields) {
  const sets = [];
  const args = [];
  for (const k of USER_COLUMNS) {
    if (k in fields) { sets.push(`${k} = ?`); args.push(fields[k]); }
  }

  // Hand-edited listing fields → merge into the user_overrides JSON map.
  const overridePatch = {};
  for (const k of OVERRIDE_FIELDS) if (k in fields) overridePatch[k] = fields[k];
  if (Object.keys(overridePatch).length) {
    const cur = getJobRaw(id);
    let ov = {};
    try { ov = cur?.user_overrides ? JSON.parse(cur.user_overrides) : {}; } catch { ov = {}; }
    const merged = { ...ov, ...overridePatch };
    sets.push("user_overrides = ?"); args.push(JSON.stringify(merged));
  }

  if (fields.status === "applied" && !getJobRaw(id)?.applied_at) {
    sets.push("applied_at = datetime('now')");
  }
  if (!sets.length) return getJob(id);
  sets.push("updated_at = datetime('now')");
  db.query(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
  if ("status" in fields) addStatusHistory(id, fields.status, fields.statusNote);
  // Keep the agent's feedback export current when pass/reject/research signals change.
  if ("status" in fields || "pass_reason" in fields || "research_status" in fields) writeAgentFeedback();
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
