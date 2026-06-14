# Orion — Handoff & Spec

This document is the source of truth for building out **Orion**, a personal,
local-first "one-stop job-getting machine." It's written so you (or Claude Code)
can pick up the scaffold in this repo and run with it. Hand Claude Code this file
and say: *"Read HANDOFF.md and let's continue."*

---

## 1. Vision

A single place that runs the whole job hunt:

- **Remembers everything.** Every listing ever discovered or slurped is stored
  forever in SQLite. Refreshes update listings in place; they are never deleted.
- **Tracks progress per job** through an application pipeline (new → interested →
  applied → phone screen → interview → offer → rejected/passed).
- **Slurps a URL.** Paste a job-posting link; Orion fetches, parses, scores, and
  files it.
- **Self-feeds.** An hourly agent searches configured sources, screens out
  struggling employers, ranks the best to the top, discovers new sources, and
  appends finds to the DB — losslessly.
- **Configurable.** A Settings page controls what's searched, priority employers,
  exclusions, sources, and agent cadence. No code edits to change the hunt.
- **Optionally smart.** With an Anthropic API key, Claude structures messy
  postings and assesses employer health. Without it, heuristics carry the load.

## 2. The candidate (encoded in scoring + default settings)

- **Role:** Frontend / React (JavaScript, React, CSS/LESS). TypeScript not required.
- **Location:** SF Bay Area **only if hybrid/onsite**; **anywhere in the US if
  fully remote**. Onsite/hybrid outside the Bay Area is penalized.
- **Priority employers:** UC schools (UC Berkeley, UCSF, UC Santa Cruz) and
  **government / city / county** roles (valued for retirement/pension) get a boost.
- **Hard exclusion:** struggling / shaky companies (he's been burned repeatedly).

## 3. Stack & conventions

- **Bun** is the runtime, package manager (`bun install`), and test runner
  (`bun test`, `bun:test`). Native SQLite via `bun:sqlite` — no DB server, no ORM.
  - ⚠️ This supersedes the usual yarn/jest defaults *for this project*. If you'd
    rather keep yarn + jest, swap `bun:test` imports for jest and use `bun --bun`
    or Node; the app code is plain ESM and portable.
- **Frontend:** React 18 + **LESS**, bundled by **Vite**. (Vite imports `.less`
  directly via the `less` dev dependency — different from a webpack setup where
  LESS is auto-handled without imports. `main.jsx` imports `styles/app.less`.)
- **No TypeScript.** Plain `.js` / `.jsx` throughout.

## 4. Architecture

```
Browser (React + LESS, Vite :5173)
        │  /api/*  (proxied in dev → :3000)
        ▼
Bun.serve API (:3000)  ── server/index.js
        │
        ├─ db.js        SQLite: jobs, status_history, sources, settings
        ├─ scoring.js   rule-based ranking (encodes the criteria above)
        ├─ slurp.js     URL → job (JSON-LD → OG meta → LLM fallback)
        ├─ llm.js       optional Claude calls (extract + health) — needs API key
        └─ import.js    bulk import of the agent's data/incoming.jsonl

Hourly agent (scheduled task, separate from the app)
        └─ appends discovered jobs to data/incoming.jsonl  → `bun run import`
           (or POSTs them to /api/jobs while the server runs)
```

## 5. Data model (`server/db.js`)

**jobs** — one row per listing. Key fields:

| field | notes |
|---|---|
| `dedupe_key` | unique; canonical URL, else hash(company+title). Upsert key. |
| `url, title, company, location, work_mode, salary, description` | listing data |
| `source` | linkedin / hn / indeed / uc / gov / manual / … |
| `employer_type` | `company` \| `uc` \| `government` |
| `score, score_reasons` | recomputed each refresh; `reasons` is JSON |
| `health_flag, health_notes` | `ok` \| `concern` \| `excluded` |
| **`status`** | pipeline stage — **user-owned** |
| **`hidden`** | 1 = sink to bottom / don't show — **user-owned** |
| **`pinned, notes`** | **user-owned** |
| `first_seen_at, last_seen_at, applied_at, created_at, updated_at` | timestamps |
| `raw_json` | full payload as discovered/slurped |

**Critical invariant:** `upsertJob()` refreshes listing/scoring fields but
**never overwrites the user-owned fields** (`status`, `hidden`, `pinned`,
`notes`). That's how the hourly agent keeps things fresh without clobbering your
progress. Honor this in any new write path.

**status_history** — append-only timeline of pipeline changes per job (powers the
per-job progress tracker).

**sources** — known + newly discovered listing sources.

**settings** — key/value JSON store. `config` holds the full search/scoring/agent
configuration (see `DEFAULT_SETTINGS`).

## 6. API (`server/index.js`)

| method | path | purpose |
|---|---|---|
| GET | `/api/jobs?includeHidden=&status=` | ranked list (pinned → active → score) |
| GET | `/api/jobs/:id` | job + status history |
| PATCH | `/api/jobs/:id` | update `status`/`hidden`/`pinned`/`notes` |
| POST | `/api/jobs` | manual add (scores + upserts) |
| POST | `/api/slurp` `{url}` | fetch + parse + score + store |
| GET/PUT | `/api/settings` | read / patch the config |
| GET | `/api/sources` · POST | list / record sources |
| GET | `/api/stats` | totals by status |

## 7. URL slurp (`server/slurp.js`)

Cheap → rich: **schema.org JobPosting JSON-LD** (LinkedIn, Greenhouse, Lever,
Workday and many ATSs embed it — fully structured) → **Open Graph / `<title>`
meta** fallback → **LLM** fallback (`/api/slurp` calls `extractJobWithLLM` when
heuristics find no title and a key is set). `parseJobFromHtml(html, url)` is pure
and unit-tested — extend it with site-specific parsers as needed.

## 8. Optional Claude smarts (`server/llm.js`)

Set `ANTHROPIC_API_KEY` in `.env` to unlock:
1. **`extractJobWithLLM`** — structure messy postings with no JSON-LD.
2. **`assessEmployerHealth`** — classify employers `ok`/`concern`/`excluded` to
   enforce the "no struggling companies" rule. *(Wire this into `ingest()` and/or
   the agent; currently available but not auto-called — a good first task.)*
Everything degrades gracefully when the key is absent.

## 9. The hourly discovery agent

Today a scheduled task ("frontend-react-job-tracker") runs hourly and rewrites a
standalone HTML file. **Migration plan:** repoint it to feed Orion instead —
each run appends normalized job objects (one JSON per line) to
`data/incoming.jsonl`, plus any newly found source as
`{"__source":{"name","url"}}`. Then `bun run import` (or a small cron) ingests
them: scores, upserts (lossless), records sources, truncates the file.

The normalized job shape the agent should emit:
```json
{"url":"…","title":"…","company":"…","location":"…",
 "work_mode":"remote|hybrid|onsite","salary":"…","description":"…",
 "source":"linkedin","employer_type":"company|uc|government",
 "health_flag":"ok|concern|excluded","health_notes":"…"}
```

## 10. Frontend (`web/`)

- **Pipeline** (`App.jsx`): slurp bar, stats, status filters, "show hidden/passed"
  toggle, ranked `JobCard` list.
- **JobCard**: score + reasons, status dropdown, pin / hide / "not interested",
  notes (autosaves on blur), expandable details + history.
- **Settings** (`Settings.jsx`): edits the full config — keywords, exclusions,
  locations, Bay Area cities, priority employers, struggling-company toggle,
  sources (add/toggle), agent cadence.

## 11. Suggested roadmap (good Claude Code tasks, in order)

1. `bun install` in root and `web/`, confirm `bun test` is green and both dev
   servers run. (Tests couldn't be run in the authoring environment — Bun wasn't
   installable there. Verify locally first.)
2. Wire `assessEmployerHealth` into `ingest()` so health is set on slurp/import.
3. Build the agent → `incoming.jsonl` → `import` loop; repoint the scheduled task.
4. Per-job **status history timeline** UI in the expanded card.
5. Real schedule control from Settings (drive the scheduled task's cron).
6. Dashboard/funnel view (counts per stage, response rates).
7. Cover-letter / fit-summary drafting via `llm.js`.
8. Export (CSV) and backup of the SQLite file.
9. **Local proxy URL + SwiftBar launcher** (see §12).

## 12. Local access: stable proxy URL + SwiftBar menu item

Orion is a local-first app, but `http://localhost:5173` (Vite dev) / `:3000`
(API) is awkward to remember and changes between dev and prod. Set up:

**a) A stable local proxy URL.** Put a small reverse proxy in front so the app
lives at a friendly hostname like `http://orion.local` (or `http://orion.test`),
proxying to the running server. Two easy options:

- **Caddy** (simplest): a one-line `Caddyfile`
  ```
  orion.local {
      reverse_proxy localhost:3000
  }
  ```
  then `caddy run`. Add `127.0.0.1 orion.local` to `/etc/hosts`.
- Or **nginx** with an equivalent `server { server_name orion.local; location / { proxy_pass http://localhost:3000; } }`.

In production the Bun server already serves the built frontend from `web/dist`
(see `server/index.js`), so the proxy only needs to target `:3000`. In dev you
may instead point it at Vite (`:5173`). Document the chosen host in `.env`
(e.g. `APP_URL=http://orion.local`).

**b) A SwiftBar menu-bar item that opens it.** [SwiftBar](https://github.com/swiftbar/SwiftBar)
runs a script and renders its stdout as a menu. Drop a plugin in the SwiftBar
plugins folder, e.g. `orion.5m.sh` (refreshes every 5 min):

```bash
#!/bin/bash
# orion.5m.sh — Orion launcher + quick stats in the menu bar
APP_URL="http://orion.local"
API="http://localhost:3000/api/stats"

echo "🌌 Orion"
echo "---"
echo "Open Orion | href=$APP_URL"
# live stats if the server is up
stats=$(curl -s --max-time 2 "$API")
if [ -n "$stats" ]; then
  total=$(echo "$stats" | /usr/bin/python3 -c 'import sys,json;print(json.load(sys.stdin).get("total",0))' 2>/dev/null)
  echo "Tracked: ${total:-?}"
fi
echo "Run search now | bash='/usr/bin/curl' param1=-s param2=http://localhost:3000/api/agent/run terminal=false refresh=true"
```

Make it executable (`chmod +x`) and place it in SwiftBar's plugin directory. The
menu shows an **Open Orion** item that launches the proxy URL in the browser, plus
optional live counts. (The "Run search now" line assumes a future
`/api/agent/run` endpoint — wire it up when the agent loop lands, or remove it.)

Requirements summary: ship a `Caddyfile` (or nginx snippet) and a
`swiftbar/orion.5m.sh` plugin in the repo, and document the install steps in the
README so Orion is one click away from the menu bar.

## 13. Notes / gotchas

- The SQLite DB in `data/` is your private history — gitignored. Back it up.
- Scheduled tasks only run while the Claude desktop app is open.
- Scoring is intentionally simple and transparent (`score_reasons`); tune freely.
- Keep the upsert invariant (§5) sacred — it's what makes "nothing is dropped" true.
