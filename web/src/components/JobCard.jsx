import { useState, useRef, useEffect } from "react";
import { api } from "../api.js";

const PIPELINE = ["new", "interested", "applied", "phone_screen", "interview", "offer", "rejected", "passed"];

// Friendly labels for the dropdown. DB values stay stable (rejected/passed); only
// the display text changes. "rejected" = they turned you down ("didn't get it").
const STATUS_LABELS = {
  phone_screen: "phone screen",
  rejected: "didn't get it",
  passed: "not interested",
};
const label = (s) => STATUS_LABELS[s] || s.replace("_", " ");

// Quick-pick reasons for "not interested" — clicking one appends it. The agent
// reads these (exported to data/agent-feedback.json) to refine future searches.
const WHY_PRESETS = [
  "Not enough React/frontend",
  "Too TypeScript-heavy",
  "Pay too low",
  "Company seems risky",
  "Wrong location / commute",
  "Stack mismatch",
];

export default function JobCard({ job, onUpdate, onReload }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(job.notes || "");
  const [reason, setReason] = useState(job.pass_reason || "");
  const [checking, setChecking] = useState(false);
  const [askReason, setAskReason] = useState(false); // prompt for "why" right after passing
  const reasonRef = useRef(null);
  const reasons = safeParse(job.score_reasons);
  const buried = job.hidden || job.status === "passed" || job.status === "rejected";
  const showReason = buried || askReason; // reason prompt shows once buried OR just-passed

  const saveReason = (r) => { if (r !== (job.pass_reason || "")) onUpdate(job.id, { pass_reason: r }); };
  const addReason = (w) => { const next = reason ? `${reason}; ${w}` : w; setReason(next); saveReason(next); };

  // Capture "why not interested" in the SAME moment you click it: pass the job,
  // open the card, reveal the reason prompt, and focus it.
  const passWithReason = () => {
    onUpdate(job.id, { status: "passed" });
    setOpen(true);
    setAskReason(true);
  };
  useEffect(() => {
    if (askReason && open && reasonRef.current) {
      reasonRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
      reasonRef.current.focus();
    }
  }, [askReason, open]);

  const recheck = async () => {
    setChecking(true);
    try { await api.reassessHealth(job.id); onReload?.(); }
    catch (e) { alert("Health check failed: " + e.message); }
    finally { setChecking(false); }
  };

  const [verifying, setVerifying] = useState(false);
  const verify = async () => {
    setVerifying(true);
    try {
      const r = await api.verifyPosting(job.id);
      if (!r.closed) alert("Still live ✓ (" + (r.verify_reason || "ok") + ")");
      onReload?.();
    } catch (e) { alert("Verify failed: " + e.message); }
    finally { setVerifying(false); }
  };

  return (
    <div className={`card ${job.pinned ? "pinned" : ""} ${buried ? "buried" : ""} health-${job.health_flag}`}>
      <div className="card-head" onClick={() => setOpen(!open)}>
        <div className="score" title={reasons.join("\n")}>{Math.round(job.score)}</div>
        <HealthSquare score={job.health_score} notes={job.health_notes} />
        <div className="who">
          <div className="title">{job.title || "(untitled)"} {job.employer_type === "uc" && <span className="badge uc">UC</span>} {job.employer_type === "government" && <span className="badge gov">GOV</span>}</div>
          <div className="sub">{job.company || "—"} · {job.location || "?"} · <span className={`mode ${job.work_mode}`}>{job.work_mode}</span> · <span className="src">{job.source}</span>{ageLabel(job) && <> · <span className="age">{ageLabel(job)}</span></>}</div>
          {job.fit_summary && <div className="fit">{job.fit_summary}</div>}
          {buried && job.pass_reason && <div className="pass-reason-tag">not interested: {job.pass_reason}</div>}
        </div>
        <select className={`status s-${job.status}`} value={job.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate(job.id, { status: e.target.value })}>
          {PIPELINE.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </select>
      </div>

      <div className="card-actions">
        {job.url && <a href={job.url} target="_blank" rel="noreferrer">open posting ↗</a>}
        <button onClick={() => onUpdate(job.id, { pinned: job.pinned ? 0 : 1 })}>{job.pinned ? "unpin" : "pin"}</button>
        <button onClick={() => onUpdate(job.id, { hidden: job.hidden ? 0 : 1 })}>{job.hidden ? "unhide" : "hide / sink"}</button>
        <button className="passed" onClick={passWithReason}>not interested</button>
        <button onClick={recheck} disabled={checking}>{checking ? "checking…" : "re-check employer"}</button>
        {job.url && !job.url.startsWith("hn://") && (
          <button onClick={verify} disabled={verifying}>{verifying ? "verifying…" : "verify still open"}</button>
        )}
      </div>

      {open && (
        <div className="card-body">
          {job.salary && <p className="salary">💰 {job.salary}</p>}
          {job.fit_summary && <p className="fit-full">{job.fit_summary}</p>}
          {job.health_notes && (
            <p className={`health health-${job.health_flag}`}>
              {job.health_flag === "ok" ? "🟢" : "⚠"} Employer health{job.health_score != null ? ` ${job.health_score}/10` : ""}: {job.health_notes}
            </p>
          )}
          {job.description && <p className="desc">{job.description}</p>}
          {reasons.length > 0 && (
            <div className="reasons">
              <div className="reasons-head">Why this ranks where it does</div>
              <ul>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          {showReason && (
            <div className="pass-reason">
              <span>why not interested? <em>the agent reads this to refine future searches</em></span>
              <div className="why-chips">
                {WHY_PRESETS.map((w) => (
                  <button type="button" key={w} onClick={() => addReason(w)}>{w}</button>
                ))}
              </div>
              <textarea ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)}
                onBlur={() => saveReason(reason)}
                placeholder="e.g. too TypeScript-heavy, pay below range, crypto-adjacent, commute too far…" />
              <div className="pass-meta">
                <label>reason type
                  <select value={job.pass_category || ""} onChange={(e) => onUpdate(job.id, { pass_category: e.target.value })}>
                    <option value="">—</option>
                    {["ethics","comp","location","seniority","stack","stability","role-type","other"].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label>applies to
                  <select value={job.pass_scope || "posting"} onChange={(e) => onUpdate(job.id, { pass_scope: e.target.value })}>
                    <option value="posting">just this posting</option>
                    <option value="company">this company forever</option>
                    <option value="similar">similar roles/companies</option>
                  </select>
                </label>
              </div>
              {job.company && (
                <button type="button" className="block-co"
                  onClick={() => { if (confirm(`Permanently block ${job.company}? The agent will never show it again.`)) api.blockCompany(job.company, reason || "blocked by user", "company").then(() => onReload?.()); }}>
                  🚫 Never show {job.company} again
                </button>
              )}
            </div>
          )}
          <div className="notes">
            <span>your notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== job.notes && onUpdate(job.id, { notes })} />
          </div>
          <div className="meta">
            {job.posted_at && <>posted {fmt(job.posted_at)} · </>}
            first seen {fmt(job.first_seen_at)} · last seen {fmt(job.last_seen_at)}
          </div>
        </div>
      )}
    </div>
  );
}

// Employer-health 1–10 in a colored square: red at 1 → amber at 5 → green at 10.
// Hue interpolates 0→120 across the range so it's a true gradient. Null = no data
// (no key yet, or not assessed) → render nothing.
function HealthSquare({ score, notes }) {
  if (score == null) return null;
  const s = Math.min(10, Math.max(1, score));
  const hue = ((s - 1) / 9) * 120;            // 1→0° (red), 10→120° (green)
  const bg = `hsl(${hue}, 65%, 42%)`;
  return (
    <div className="health-square" style={{ background: bg }}
      title={`Employer health ${s}/10${notes ? " — " + notes : ""}`}>
      {s}
    </div>
  );
}

function safeParse(s) { try { return JSON.parse(s) || []; } catch { return []; } }
function fmt(d) { return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString() : "—"; }

// Human "age" of the posting. Prefer the source's posted_at; otherwise fall back
// to when Orion first saw it (prefixed "seen" so it's not mistaken for post date).
function ageLabel(job) {
  const posted = parseDate(job.posted_at);
  const seen = parseDate(job.first_seen_at);
  const d = posted || seen;
  if (!d) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  const rel = days <= 0 ? "today" : days === 1 ? "1 day" : days < 30 ? `${days} days`
    : days < 60 ? "1 month" : `${Math.floor(days / 30)} months`;
  return posted ? `posted ${rel === "today" ? "today" : rel + " ago"}`
                : `seen ${rel === "today" ? "today" : rel + " ago"}`;
}
function parseDate(d) {
  if (!d) return null;
  const t = new Date(d.replace(" ", "T") + (d.includes("T") ? "" : "Z"));
  return isNaN(t.getTime()) ? null : t;
}
