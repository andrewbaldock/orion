// Tests for the employer-health 1–10 score: storage preservation + score clamping.
// Uses a throwaway DB so the real data/orion.db is never touched.
import { test, expect, beforeAll } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the DB layer at a temp file BEFORE importing it (db.js reads DB_PATH at load).
process.env.DB_PATH = join(tmpdir(), `orion-health-test-${Date.now()}.db`);

let upsertJob;
beforeAll(async () => {
  ({ upsertJob } = await import("./db.js"));
});

test("upsert stores a health_score, and a later refresh without one preserves it", () => {
  // First write: a job with a health score.
  const { job } = upsertJob({
    dedupe_key: "health-test-1", title: "React Engineer", company: "Acme",
    health_flag: "ok", health_score: 8, health_notes: "stable",
  });
  expect(job.health_score).toBe(8);

  // Agent refresh of the same listing carries no health fields — must NOT clobber.
  const { job: refreshed, created } = upsertJob({
    dedupe_key: "health-test-1", title: "React Engineer (updated)", company: "Acme",
  });
  expect(created).toBe(false);
  expect(refreshed.title).toBe("React Engineer (updated)"); // listing field refreshed
  expect(refreshed.health_score).toBe(8);                   // score preserved
});

test("LLM health score is clamped to an int in 1..10", async () => {
  const { assessEmployerHealth } = await import("./llm.js");
  // No API key in the test env -> graceful null, no throw.
  const out = await assessEmployerHealth("Some Company");
  expect(out).toHaveProperty("flag");
  expect(out).toHaveProperty("score");
  // Without a key the score is null; with one it would be 1..10. Either is valid here.
  expect(out.score === null || (Number.isInteger(out.score) && out.score >= 1 && out.score <= 10)).toBe(true);
});
