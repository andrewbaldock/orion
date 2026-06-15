// Orion API server — Bun.serve. No framework needed.
import {
  upsertJob, getJob, listJobs, updateUserFields, getStatusHistory,
  listSources, recordSource, stats, getConfig, setConfig, purgeJob,
  getAvoid, setAvoid, addAvoidCompany, removeAvoidCompany,
} from "./db.js";
import { slurpUrl, parseJobFromHtml, verifyPosting } from "./slurp.js";
import { llmEnabled, extractJobWithLLM } from "./llm.js";
import { ingest, ingestBatch, lookupHealth, clearHealthCache } from "./ingest.js";

const PORT = Number(process.env.PORT || 3000);

// Absolute path to the built frontend, resolved from THIS file — not the process
// CWD — so serving works when launched from launchd (login auto-start) where the
// working directory isn't the repo root.
const DIST = new URL("../web/dist/", import.meta.url).pathname;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;
    const method = req.method;

    if (method === "OPTIONS") return json({}, 204);

    try {
      // GET /api/jobs
      if (pathname === "/api/jobs" && method === "GET") {
        const includeHidden = url.searchParams.get("includeHidden") !== "false";
        const status = url.searchParams.get("status");
        return json(listJobs({ includeHidden, status }));
      }

      // GET /api/jobs/:id  -> job + status history
      const idMatch = pathname.match(/^\/api\/jobs\/(\d+)$/);
      if (idMatch && method === "GET") {
        const job = getJob(Number(idMatch[1]));
        if (!job) return json({ error: "not found" }, 404);
        return json({ ...job, history: getStatusHistory(job.id) });
      }

      // PATCH /api/jobs/:id  -> update user fields (status, hidden, pinned, notes)
      if (idMatch && (method === "PATCH" || method === "PUT")) {
        const body = await req.json();
        const job = updateUserFields(Number(idMatch[1]), body);
        if (!job) return json({ error: "not found" }, 404);
        return json(job);
      }

      // POST /api/jobs  -> manual add (also re-scores)
      if (pathname === "/api/jobs" && method === "POST") {
        const body = await req.json();
        return json(await ingest(body), 201);
      }

      // POST /api/ingest  -> batch ingest a whole agent run over HTTP, so the
      // always-on host API is the SINGLE DB writer (no cross-kernel SQLite access
      // from the sandbox). Body = an array of records, or { records: [...] };
      // each is a job or a {"__source":{…}} row. Returns the run summary.
      if (pathname === "/api/ingest" && method === "POST") {
        const body = await req.json();
        const records = Array.isArray(body) ? body : Array.isArray(body?.records) ? body.records : null;
        if (!records) return json({ error: "expected an array of records or { records: [...] }" }, 400);
        const res = await ingestBatch(records);
        return json({ ran_at: new Date().toISOString(), ...res });
      }

      // POST /api/jobs/:id/verify  -> fetch the posting URL; if it's a dead link or
      // shows a "closed/expired/filled" marker, PURGE the job (delete it + remember
      // the url so the agent never re-adds it). Safety net for stale agent finds.
      const verifyMatch = pathname.match(/^\/api\/jobs\/(\d+)\/verify$/);
      if (verifyMatch && method === "POST") {
        const job = getJob(Number(verifyMatch[1]));
        if (!job) return json({ error: "not found" }, 404);
        if (!job.url) return json({ error: "job has no url to verify" }, 400);
        // Exempt user records: manual adds + any hand-edited row shouldn't be
        // auto-purged as a "dead link" (Andrew owns these).
        if (job.source === "manual" || job.user_overrides) {
          return json({ purged: false, reason: "exempt (manual / user-edited)" });
        }
        const { closed, reason } = await verifyPosting(job.url);
        if (closed) { purgeJob(job.id, reason); return json({ purged: true, reason }); }
        return json({ purged: false, reason });
      }

      // POST /api/jobs/:id/health  -> recompute employer health for this job's company
      const healthMatch = pathname.match(/^\/api\/jobs\/(\d+)\/health$/);
      if (healthMatch && method === "POST") {
        const job = getJob(Number(healthMatch[1]));
        if (!job) return json({ error: "not found" }, 404);
        if (!llmEnabled()) return json({ error: "ANTHROPIC_API_KEY not set" }, 400);
        if (!job.company) return json({ error: "job has no company" }, 400);
        clearHealthCache(job.company); // force a fresh look
        const h = await lookupHealth(job.company, job.description || "");
        const updated = upsertJob({
          dedupe_key: job.dedupe_key,
          health_flag: h?.flag, health_score: h?.score, health_notes: h?.notes,
        });
        return json(updated.job);
      }

      // POST /api/slurp  { url }  -> fetch + parse + store
      if (pathname === "/api/slurp" && method === "POST") {
        const { url: target } = await req.json();
        if (!target) return json({ error: "url required" }, 400);
        let parsed = await slurpUrl(target);
        // If heuristics couldn't get a title and Claude is enabled, ask it to
        // structure the raw page text.
        if (!parsed.title && llmEnabled()) {
          try {
            const html = await (await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (OrionJobBot)" } })).text();
            const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
            const llm = await extractJobWithLLM(text, target);
            if (llm) parsed = { ...parsed, ...llm };
          } catch (e) { console.warn("LLM slurp fallback failed:", e.message); }
        }
        const { job, created } = await ingest({ ...parsed, dedupe_key: target });
        return json({ job, created }, created ? 201 : 200);
      }

      // GET /api/sources
      if (pathname === "/api/sources" && method === "GET") return json(listSources());
      // POST /api/sources
      if (pathname === "/api/sources" && method === "POST") {
        const { name, url: u } = await req.json();
        recordSource(name, u);
        return json({ ok: true }, 201);
      }

      // GET /api/stats
      if (pathname === "/api/stats" && method === "GET") return json(stats());

      // GET /api/settings  -> full search/scoring/agent config
      if (pathname === "/api/settings" && method === "GET") return json(getConfig());
      // PUT /api/settings  -> patch config (merges top-level keys)
      if (pathname === "/api/settings" && (method === "PUT" || method === "PATCH")) {
        const body = await req.json();
        return json(setConfig(body));
      }

      // --- Avoid rules (ethics/values blocklist) ---
      // GET  /api/avoid              -> { companies, patterns }
      // POST /api/avoid/company {company,reason,scope}  -> add a hard block (+ purge matches)
      // DELETE /api/avoid/company {company}             -> remove a hard block
      // PUT  /api/avoid             -> replace the whole avoid object (patterns edits)
      if (pathname === "/api/avoid" && method === "GET") return json(getAvoid());
      if (pathname === "/api/avoid" && (method === "PUT" || method === "PATCH")) {
        return json(setAvoid(await req.json()));
      }
      if (pathname === "/api/avoid/company" && method === "POST") {
        const { company, reason, scope } = await req.json();
        if (!company) return json({ error: "company required" }, 400);
        return json(addAvoidCompany(company, reason || "", scope || "company"));
      }
      if (pathname === "/api/avoid/company" && method === "DELETE") {
        const { company } = await req.json();
        return json(removeAvoidCompany(company));
      }

      // serve built frontend in production (web/dist), via absolute DIST path
      if (method === "GET" && !pathname.startsWith("/api/")) {
        const file = Bun.file(DIST + (pathname === "/" ? "index.html" : pathname.slice(1)));
        if (await file.exists()) return new Response(file);
        const index = Bun.file(DIST + "index.html");
        if (await index.exists()) return new Response(index);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: String(err.message || err) }, 500);
    }
  },
});

console.log(`🪐 Orion API listening on http://localhost:${server.port}`);
