// Orion scoring — encodes Andrew's criteria so the best roles rise to the top.
//
// Criteria (from setup):
//  - Role: Frontend / React (JS, CSS/LESS). TypeScript not required.
//  - Location: SF Bay Area only if hybrid/onsite; anywhere in US if fully remote.
//  - Prioritized employers: UC schools (Berkeley/UCSF/UCSC) and government/city
//    jobs (retirement benefits) get a boost.
//  - Hard exclusion: struggling / shaky companies.

const BAY_AREA = [
  "san francisco", "sf", "bay area", "oakland", "berkeley", "south san francisco",
  "palo alto", "mountain view", "san jose", "santa clara", "sunnyvale", "san mateo",
  "redwood city", "emeryville", "fremont", "santa cruz", "menlo park", "cupertino",
];

const REACT_TERMS = ["react", "frontend", "front-end", "front end", "javascript", "css", "less", "ui engineer", "web developer"];

// Pull the TOP of a pay range out of free-text salary, in USD/year. Salary is a
// free-form TEXT field ("142000-210000 USD/year", "$150k–$175k", "$120k"), so we
// scan for dollar figures, expand "k" to thousands, and take the largest (the top
// of the band — Andrew's floor is "the most this could pay me"). Returns null when
// there's no parseable figure (don't penalize unknown comp) or when the number
// looks like an hourly/monthly rate. Exported for testing.
export function parseTopSalary(salary) {
  if (!salary || typeof salary !== "string") return null;
  const s = salary.toLowerCase();
  if (/\b(hour|hr|hourly|month|monthly)\b|\/\s*(hr|hour|mo|month)/.test(s)) return null;
  const nums = [];
  // Match figures like 175,000 / 175000 / 175k / 1.5k — with optional $ and commas.
  const re = /\$?\s*(\d[\d,]*\.?\d*)\s*(k\b|thousand|m\b|million)?/g;
  let m;
  while ((m = re.exec(s))) {
    let n = parseFloat(m[1].replace(/,/g, ""));
    if (isNaN(n)) continue;
    const unit = m[2];
    if (unit === "k" || unit === "thousand") n *= 1000;
    else if (unit === "m" || unit === "million") n *= 1_000_000;
    // Bare figures without a unit that are plainly too small to be an annual salary
    // (e.g. "2" from "2 days") are noise — only count >= 1000 or anything with a unit.
    if (n >= 1000 || unit) nums.push(n);
  }
  if (!nums.length) return null;
  return Math.max(...nums);
}

export function scoreJob(job) {
  const reasons = [];
  let score = 0;

  const text = `${job.title || ""} ${job.description || ""}`.toLowerCase();
  const loc = (job.location || "").toLowerCase();
  const mode = (job.work_mode || "unknown").toLowerCase();

  // 1) Role match
  const roleHits = REACT_TERMS.filter((t) => text.includes(t));
  if (roleHits.length) {
    const pts = Math.min(40, roleHits.length * 12);
    score += pts;
    reasons.push(`React/frontend match (+${pts})`);
  } else {
    reasons.push("No clear frontend/React match (0)");
  }

  // 2) Location / work-mode fit  (this is a gate as well as a score)
  const inBay = BAY_AREA.some((c) => loc.includes(c));
  const isRemote = mode.includes("remote") || /remote/.test(text);
  if (isRemote) {
    score += 25; reasons.push("Fully remote (US-eligible) (+25)");
  } else if (inBay && (mode.includes("hybrid") || mode.includes("onsite") || mode.includes("office"))) {
    score += 25; reasons.push("Bay Area hybrid/onsite (+25)");
  } else if (inBay) {
    score += 15; reasons.push("Bay Area, mode unclear (+15)");
  } else {
    score -= 30; reasons.push("Onsite/hybrid outside Bay Area — likely disqualifying (-30)");
  }

  // 3) Priority employers
  if (job.employer_type === "uc" || /\buc\b|university of california|berkeley|ucsf|santa cruz/.test((job.company || "").toLowerCase())) {
    score += 25; reasons.push("UC school (priority) (+25)");
  }
  if (job.employer_type === "government" || /city of|county of|state of|\.gov|government/.test(`${job.company || ""} ${job.url || ""}`.toLowerCase())) {
    score += 22; reasons.push("Government role — retirement benefits (priority) (+22)");
  }

  // 4) Recency (favor fresh)
  if (job.last_seen_at) {
    const ageDays = (Date.now() - new Date(job.last_seen_at).getTime()) / 86400000;
    if (ageDays < 2) { score += 8; reasons.push("Posted/seen recently (+8)"); }
    else if (ageDays > 21) { score -= 8; reasons.push("Stale listing (-8)"); }
  }

  // 5) Employer health
  if (job.health_flag === "excluded") {
    score -= 100; reasons.push("Struggling/shaky employer — EXCLUDED (-100)");
  } else if (job.health_flag === "concern") {
    score -= 25; reasons.push("Health concern flagged (-25)");
  }

  // 5b) Comp floor. Penalize roles whose top-of-range is clearly below Andrew's
  // minSalary (passed in from searchProfile). "Clearly" = below 95% of the floor, so
  // a role that just grazes it isn't dinged for rounding. Unparseable/absent comp is
  // NOT penalized (we don't punish unknowns). minSalary 0/null disables the term.
  const floor = Number(job.minSalary) || 0;
  if (floor > 0) {
    const top = parseTopSalary(job.salary);
    if (top != null && top < floor * 0.95) {
      score -= 30; reasons.push(`Top of pay range ($${Math.round(top / 1000)}k) below your $${Math.round(floor / 1000)}k floor (-30)`);
    }
  }

  // 6) Andrew's "⭐ I like them" boost — a user-owned positive signal, the mirror
  // of the avoid/pass penalties. Symmetric in magnitude to the concern penalty so
  // a liked role clearly floats above a comparable un-liked one without nuking the
  // rest of the ranking. liked is preserved across agent refreshes (see ingest).
  if (job.liked) {
    score += 30; reasons.push("⭐ You like this employer (+30)");
  }

  return { score: Math.round(score), reasons };
}
