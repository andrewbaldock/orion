import { test, expect } from "bun:test";
import { parseJobFromHtml, classifyEmployer } from "./slurp.js";

test("parses schema.org JobPosting JSON-LD", () => {
  const html = `<html><head>
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"JobPosting",
     "title":"Senior Frontend Engineer (React)",
     "description":"<p>Build <b>React</b> UIs.</p>",
     "hiringOrganization":{"@type":"Organization","name":"Acme Co"},
     "jobLocation":{"@type":"Place","address":{"addressLocality":"San Francisco","addressRegion":"CA"}},
     "jobLocationType":"TELECOMMUTE",
     "baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"minValue":150000,"maxValue":190000,"unitText":"YEAR"}}}
    </script></head><body></body></html>`;
  const job = parseJobFromHtml(html, "https://boards.greenhouse.io/acme/jobs/1");
  expect(job.title).toBe("Senior Frontend Engineer (React)");
  expect(job.company).toBe("Acme Co");
  expect(job.location).toBe("San Francisco, CA");
  expect(job.work_mode).toBe("remote");
  expect(job.description).toContain("React");
  expect(job.salary).toContain("150000");
  expect(job.source).toBe("greenhouse");
});

test("falls back to Open Graph meta when no JSON-LD", () => {
  const html = `<html><head>
    <meta property="og:title" content="Frontend Developer at FooBar">
    <meta property="og:description" content="Hybrid role in Berkeley, CA">
    <meta property="og:site_name" content="FooBar">
    <title>ignored</title></head><body>hybrid</body></html>`;
  const job = parseJobFromHtml(html, "https://example.com/jobs/2");
  expect(job.title).toBe("Frontend Developer at FooBar");
  expect(job.company).toBe("FooBar");
  expect(job.work_mode).toBe("hybrid");
});

test("classifies UC and government employers", () => {
  expect(classifyEmployer({ company: "UC Berkeley" })).toBe("uc");
  expect(classifyEmployer({ url: "https://careers.sf.gov/role/1" })).toBe("government");
  expect(classifyEmployer({ company: "Random Startup" })).toBe("company");
});
