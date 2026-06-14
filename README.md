# 🌌 Orion

Your one-stop job-hunting machine. A persistent database of every listing it
ever sees, per-job progress tracking, a "slurp a URL" importer, configurable
search, and an hourly discovery agent that keeps it fed — built so **nothing is
ever dropped**.

Stack: **Bun** (runtime · package manager · test runner · native `bun:sqlite`)
+ **SQLite**, **React + LESS** frontend (Vite). No TypeScript.

## Quick start

```bash
# 1. install deps (root = backend, web = frontend)
bun install
cd web && bun install && cd ..

# 2. set up env
cp .env.example .env

# 3. run the API (terminal 1)
bun run dev:server          # http://localhost:3000

# 4. run the frontend (terminal 2)
bun run dev:web             # http://localhost:5173

# tests
bun test
```

Open http://localhost:5173, paste a job-posting URL into the slurp bar, and go.

## What's here

- `server/` — Bun API, SQLite layer, URL slurp, scoring, optional Claude smarts.
- `web/` — React + LESS frontend (Pipeline + Settings).
- `prototype/job-tracker.html` — the original static prototype, kept for reference.
- `HANDOFF.md` — **read this first.** Full spec, data model, roadmap, and how to
  continue in Claude Code.
- `ARCHITECTURE.md` — how the whole stack fits together, with diagrams.
- `data/` — your SQLite DB lives here (gitignored — it's your private history).

## Architecture

The discovery agent (sandboxed, ephemeral) only ever **appends** jobs to a flat
file; a host-side `launchd` watcher imports them so the always-on API stays the
**single** database writer. Full write-up and a sequence diagram in
**[ARCHITECTURE.md](./ARCHITECTURE.md)**.

<p align="center">
  <a href="./ARCHITECTURE.md">
    <img src="docs/orion-architecture.png" alt="Orion architecture diagram — discovery agent appends to incoming.jsonl, a host launchd watcher imports into SQLite, the always-on Bun API serves the React frontend through Caddy" width="430">
  </a>
</p>

See **[HANDOFF.md](./HANDOFF.md)** for everything else.
