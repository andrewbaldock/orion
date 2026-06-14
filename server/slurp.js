// Orion "slurp" — paste a job-posting URL, get a structured job back.
//
// Strategy (cheap -> rich):
//   1. schema.org JobPosting JSON-LD  (LinkedIn, Greenhouse, Lever, many ATSs
//      embed this — it's the gold path, fully structured).
//   2. Open Graph / <title> / meta fallback for sites without JSON-LD.
//   3. (Optional) hand the raw text to an LLM if ANTHROPIC_API_KEY is set and
//      the heuristics came up empty. Left as a stub — wire up in Claude Code.
//
// parseJobFromHtml() is pure (html string -> partial job) so it's unit-testable
// without network access.

export function parseJobFromHtml(html, url = "") {
  const out = { url, source: sourceFromUrl(url) };

  // --- 1. JSON-LD JobPosting -------------------------------------------------
  const ld = extractJsonLd(html).find((o) => matchesType(o, "JobPosting"));
  if (ld) {
    out.title = clean(ld.title);
    out.description = stripTags(clean(ld.description));
    if (ld.hiringOrganization) {
      out.company = clean(ld.hiringOrganization.name || ld.hiringOrganization);
    }
    out.location = jobLocation(ld);
    out.work_mode = workMode(ld, html);
    out.salary = salary(ld);
    out.raw_json = ld;
    return finalize(out);
  }

  // --- 2. Open Graph / meta fallback ----------------------------------------
  out.title = meta(html, "og:title") || titleTag(html);
  out.description = meta(html, "og:description") || meta(html, "description");
  out.company = meta(html, "og:site_name");
  out.work_mode = workMode(null, html);
  return finalize(out);
}

export async function slurpUrl(url, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "Mozilla/5.0 (OrionJobBot)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const html = await res.text();
  return parseJobFromHtml(html, url);
}

// Check whether a posting is still live. Returns { closed, reason }.
// closed=true on a dead URL (4xx/5xx/network) or when the page text shows a
// closed/expired/filled marker. Conservative: ambiguous → closed=false (don't
// bury a live job on a false positive). Safety net for stale agent finds.
const CLOSED_MARKERS = [
  "this opening is closed", "no longer accepting applications", "position has been filled",
  "this job is no longer available", "posting has expired", "this position is closed",
  "applications are closed", "job posting not found", "this listing has expired",
];
export async function verifyPosting(url, { fetchImpl = fetch } = {}) {
  if (!url || url.startsWith("hn://")) return { closed: false, reason: "unverifiable url (skipped)" };
  let res;
  try {
    res = await fetchImpl(url, { headers: { "User-Agent": "Mozilla/5.0 (OrionJobBot)" }, redirect: "follow" });
  } catch (e) {
    return { closed: true, reason: `unreachable: ${e.message}` };
  }
  if (res.status === 404 || res.status === 410) return { closed: true, reason: `HTTP ${res.status}` };
  if (!res.ok) return { closed: false, reason: `HTTP ${res.status} (kept — not a definite close)` };
  const text = (await res.text()).toLowerCase();
  const hit = CLOSED_MARKERS.find((m) => text.includes(m));
  return hit ? { closed: true, reason: `page says: "${hit}"` } : { closed: false, reason: "live" };
}

// --- internals --------------------------------------------------------------

function finalize(out) {
  if (out.title) out.title = out.title.trim();
  if (out.company) out.company = out.company.trim();
  out.employer_type = classifyEmployer(out);
  return out;
}

export function classifyEmployer({ company = "", url = "" } = {}) {
  const s = `${company} ${url}`.toLowerCase();
  if (/university of california|uc berkeley|ucsf|uc santa cruz|berkeley\.edu|ucsc\.edu|ucsf\.edu/.test(s)) return "uc";
  if (/\.gov|city of|county of|state of|government/.test(s)) return "government";
  return "company";
}

function sourceFromUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("linkedin")) return "linkedin";
    if (h.includes("indeed")) return "indeed";
    if (h.includes("ycombinator") || h.includes("hnhiring")) return "hn";
    if (h.includes("greenhouse")) return "greenhouse";
    if (h.includes("lever")) return "lever";
    if (h.includes("myworkdayjobs")) return "workday";
    if (h.endsWith(".edu")) return "uc";
    if (h.endsWith(".gov")) return "gov";
    return h;
  } catch { return "manual"; }
}

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else if (parsed["@graph"]) blocks.push(...parsed["@graph"]);
      else blocks.push(parsed);
    } catch { /* skip malformed */ }
  }
  return blocks;
}

function matchesType(obj, type) {
  const t = obj && obj["@type"];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function jobLocation(ld) {
  const loc = ld.jobLocation;
  const addr = (Array.isArray(loc) ? loc[0] : loc)?.address;
  if (!addr) return ld.applicantLocationRequirements?.name || null;
  if (typeof addr === "string") return addr;
  return [addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") || null;
}

function workMode(ld, html) {
  const s = `${ld?.jobLocationType || ""} ${html || ""}`.toLowerCase();
  if (ld?.jobLocationType === "TELECOMMUTE" || /\bremote\b/.test(s)) return "remote";
  if (/\bhybrid\b/.test(s)) return "hybrid";
  if (/\bon-?site\b|in office|in-office/.test(s)) return "onsite";
  return "unknown";
}

function salary(ld) {
  const v = ld.baseSalary?.value;
  if (!v) return null;
  const unit = v.unitText ? `/${v.unitText.toLowerCase()}` : "";
  if (v.minValue && v.maxValue) return `${v.minValue}-${v.maxValue} ${v.currency || ""}${unit}`.trim();
  if (v.value) return `${v.value} ${v.currency || ""}${unit}`.trim();
  return null;
}

function meta(html, name) {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? decodeEntities(m2[1]) : null;
}

function titleTag(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].trim()) : null;
}

function stripTags(s = "") { return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }
function clean(s) { return typeof s === "string" ? decodeEntities(s) : s; }
function decodeEntities(s = "") {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}
