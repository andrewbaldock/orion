// Orion API server — Bun.serve. No framework needed.
import {
  upsertJob, getJob, listJobs, updateUserFields, getStatusHistory,
  listSources, recordSource, stats, getConfig, setConfig,
} from "./db.js";
import { scoreJob } from "./scoring.js";
import { slurpUrl, parseJobFromHtml, classifyEmployer } from "./slurp.js";
import { llmEnabled, extractJobWithLLM } from "./llm.js";

const PORT = Number(process.env.PORT || 3000);

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
        return json(ingest(body), 201);
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
        const { job, created } = ingest({ ...parsed, dedupe_key: target });
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

      // serve built frontend in production (web/dist)
      if (method === "GET" && !pathname.startsWith("/api/")) {
        const file = Bun.file("web/dist" + (pathname === "/" ? "/index.html" : pathname));
        if (await file.exists()) return new Response(file);
        const index = Bun.file("web/dist/index.html");
        if (await index.exists()) return new Response(index);
      }

      return json({ error: "not found" }, 404);
    } catch (err) {
      console.error(err);
      return json({ error: String(err.message || err) }, 500);
    }
  },
});

// Score then upsert. Centralized so /slurp, /jobs POST, and the importer agree.
export function ingest(payload) {
  if (!payload.employer_type) payload.employer_type = classifyEmployer(payload);
  const { score, reasons } = scoreJob(payload);
  return upsertJob({ ...payload, score, score_reasons: reasons });
}

console.log(`🪐 Orion API listening on http://localhost:${server.port}`);
