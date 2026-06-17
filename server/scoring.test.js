import { test, expect } from "bun:test";
import { scoreJob, parseTopSalary } from "./scoring.js";

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

test("liked employer gets a positive boost", () => {
  const job = { title: "Frontend Engineer", description: "React", work_mode: "remote", location: "Remote (US)" };
  const base = scoreJob(job).score;
  const liked = scoreJob({ ...job, liked: 1 });
  expect(liked.score).toBe(base + 30);
  expect(liked.reasons.join(" ")).toContain("like");
});

test("parseTopSalary pulls the top of a range in USD/year", () => {
  expect(parseTopSalary("142000-210000 USD/year")).toBe(210000);
  expect(parseTopSalary("$150k–$175k")).toBe(175000);
  expect(parseTopSalary("$120k")).toBe(120000);
  expect(parseTopSalary("150,000 to 175,000")).toBe(175000);
  expect(parseTopSalary("$60/hour")).toBeNull();   // hourly → ignore
  expect(parseTopSalary("competitive")).toBeNull(); // no figure → ignore
  expect(parseTopSalary(null)).toBeNull();
});

test("sub-floor comp is penalized; at/above floor is not", () => {
  const job = { title: "Frontend Engineer", description: "React", work_mode: "remote", location: "Remote (US)" };
  const below = scoreJob({ ...job, salary: "$120k–$130k", minSalary: 175000 });
  const above = scoreJob({ ...job, salary: "$180k–$210k", minSalary: 175000 });
  const noFloor = scoreJob({ ...job, salary: "$120k–$130k", minSalary: 0 });
  expect(below.score).toBe(above.score - 30);
  expect(below.reasons.join(" ")).toContain("below your");
  expect(noFloor.reasons.join(" ")).not.toContain("below your"); // floor disabled
});
