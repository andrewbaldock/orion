// Optional Claude-powered "smarts". Everything here degrades gracefully:
// if ANTHROPIC_API_KEY is unset, callers fall back to heuristics and Orion
// still works. Set the key in .env to unlock:
//   1. extractJobWithLLM  — structure a messy posting that has no JSON-LD.
//   2. assessEmployerHealth — flag struggling/shaky companies (the hard-exclude rule).
//   3. (room to grow) cover-letter drafts, fit summaries, dedupe-by-meaning, etc.

const MODEL = process.env.ORION_MODEL || "claude-opus-4-8";
const API = "https://api.anthropic.com/v1/messages";

export function llmEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

async function callClaude(prompt, { maxTokens = 1024, system } = {}) {
  if (!llmEnabled()) throw new Error("ANTHROPIC_API_KEY not set");
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.[0]?.text ?? "";
}

function parseJsonFromText(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

/** Structure a raw posting (visible text) into job fields. */
export async function extractJobWithLLM(rawText, url = "") {
  const prompt = `Extract this job posting into JSON with keys:
title, company, location, work_mode (remote|hybrid|onsite|unknown), salary, description (1-2 sentence summary).
Return ONLY the JSON object.

URL: ${url}
POSTING:
${rawText.slice(0, 8000)}`;
  const out = await callClaude(prompt, { maxTokens: 800 });
  return parseJsonFromText(out);
}

/**
 * Judge whether an employer looks financially shaky / struggling.
 * Returns { flag: 'ok'|'concern'|'excluded', score: 1..10|null, notes }.
 *   score: 1 = likely failing / avoid, 10 = rock solid. null when no key / parse fail.
 * Note: pass in any recent context you have (the agent can supply news snippets).
 */
export async function assessEmployerHealth(company, context = "") {
  if (!company) return { flag: "ok", score: null, notes: null };
  const prompt = `You assess employer stability for a job seeker who has repeatedly
been burned by struggling companies. Given the company and any context:
1. Rate stability 1-10 (1 = likely failing / recent major layoffs / down round / bankruptcy
   risk; 5 = mixed or unclear; 10 = rock solid, well-funded, growing).
2. Map to a flag: 1-3 -> "excluded", 4-6 -> "concern", 7-10 -> "ok".
Return ONLY JSON: {"score":<1-10 int>,"flag":"ok|concern|excluded","notes":"one sentence"}.

COMPANY: ${company}
CONTEXT: ${context || "(none provided)"}`;
  try {
    const out = await callClaude(prompt, { maxTokens: 200 });
    const parsed = parseJsonFromText(out);
    if (!parsed) return { flag: "ok", score: null, notes: null };
    // Clamp the score to a 1-10 int; leave null if the model omitted it.
    let score = Number(parsed.score);
    score = Number.isFinite(score) ? Math.min(10, Math.max(1, Math.round(score))) : null;
    return { flag: parsed.flag || "ok", score, notes: parsed.notes || null };
  } catch {
    return { flag: "ok", score: null, notes: null };
  }
}
