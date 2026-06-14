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

  return { score: Math.round(score), reasons };
}
