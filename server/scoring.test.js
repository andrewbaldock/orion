import { test, expect } from "bun:test";
import { scoreJob } from "./scoring.js";

test("remote React role scores well", () => {
  const { score, reasons } = scoreJob({
    title: "Senior React Frontend Engineer",
    description: "Remote. Build UIs in React, JavaScript, CSS.",
    work_mode: "remote", location: "Remote (US)",
  });
  expect(score).toBeGreaterThan(40);
  expect(reasons.join(" ")).toContain("remote");
});

test("UC employer gets a boost", () => {
  const base = scoreJob({ title: "Frontend Engineer", description: "React", work_mode: "hybrid", location: "Berkeley, CA" }).score;
  const uc = scoreJob({ title: "Frontend Engineer", description: "React", work_mode: "hybrid", location: "Berkeley, CA", employer_type: "uc" }).score;
  expect(uc).toBeGreaterThan(base);
});

test("excluded (struggling) employer is buried", () => {
  const { score } = scoreJob({
    title: "React Engineer", description: "remote react", work_mode: "remote",
    health_flag: "excluded",
  });
  expect(score).toBeLessThan(0);
});

test("onsite role outside Bay Area is penalized", () => {
  const { score } = scoreJob({
    title: "React Engineer", description: "Onsite in Austin, TX",
    work_mode: "onsite", location: "Austin, TX",
  });
  expect(score).toBeLessThan(30);
});
