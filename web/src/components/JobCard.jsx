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
  const [editing, setEditing] = useState(false);     // inline edit mode for listing fields
  const [draft, setDraft] = useState(null);
  const [askResearch, setAskResearch] = useState(false);
  const [rNote, setRNote] = useState(job.research_note || "");
  const reasonRef = useRef(null);

  const EDITABLE = ["title", "company", "location", "work_mode", "salary", "description", "fit_summary", "url", "direct_url", "employer_type", "posted_at"];
  const startEdit = () => { setDraft(Object.fromEntries(EDITABLE.map((k) => [k, job[k] ?? ""]))); setEditing(true); setOpen(true); };
  const saveEdit = () => {
    // Only send fields that actually changed → recorded into user_overrides server-side.
    const patch = {};
    for (const k of EDITABLE) if ((draft[k] ?? "") !== (job[k] ?? "")) patch[k] = draft[k];
    if (Object.keys(patch).length) onUpdate(job.id, patch);
    setEditing(false);
  };
  const requestResearch = () => {
    onUpdate(job.id, { research_status: "requested", research_note: rNote });
    setAskResearch(false);
  };
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
    <div className={`card ${job.pinned ? "pinned" : ""} ${buried ? "buried" : ""} health-${job.health_flag}`}
      data-status={job.hidden ? "passed" : job.status}>
      <div className="card-head" onClick={() => setOpen(!open)}>
        <div className="score" title={reasons.join("\n")}>{Math.round(job.score)}</div>
        <HealthSquare score={job.health_score} notes={job.health_notes} />
        <div className="who">
          <div className="title">{job.title || "(untitled)"} {job.employer_type === "uc" && <span className="badge uc">UC</span>} {job.employer_type === "government" && <span className="badge gov">GOV</span>}</div>
          <div className="company">{job.company || "—"}</div>
          <div className="sub">{job.location || "?"} · <span className={`mode ${job.work_mode}`}>{job.work_mode}</span> · <span className="src">{job.source}</span>{ageLabel(job) && <> · <span className="age">{ageLabel(job)}</span></>}</div>
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
        {job.direct_url && job.direct_url !== job.url && <a className="direct" href={job.direct_url} target="_blank" rel="noreferrer">company posting ↗</a>}
        <button className={`like ${job.liked ? "liked" : ""}`}
          title={job.liked ? "you like this employer — boosts its score; click to remove" : "I like this employer — boost its score"}
          onClick={() => onUpdate(job.id, { liked: job.liked ? 0 : 1 })}>{job.liked ? "★ liked" : "☆ like"}</button>
        <button onClick={() => onUpdate(job.id, { pinned: job.pinned ? 0 : 1 })}>{job.pinned ? "unpin" : "pin"}</button>
        <button onClick={() => onUpdate(job.id, { hidden: job.hidden ? 0 : 1 })}>{job.hidden ? "unhide" : "hide / sink"}</button>
        <button className="passed" onClick={passWithReason}>not interested</button>
        <button onClick={recheck} disabled={checking}>{checking ? "checking…" : "re-check employer"}</button>
        {job.url && !job.url.startsWith("hn://") && job.source !== "manual" && !job.user_overrides && (
          <button onClick={verify} disabled={verifying}>{verifying ? "verifying…" : "verify still open"}</button>
        )}
        <button onClick={editing ? saveEdit : startEdit}>{editing ? "save edits" : "edit"}</button>
        <button onClick={() => { setAskResearch((v) => !v); setOpen(true); }}>🔍 research</button>
      </div>

      {open && (
        <div className="card-body">
          {editing && (
            <div className="edit-form">
              <div className="edit-head">Edit listing <em>your edits override the agent's data and survive refreshes</em></div>
              {EDITABLE.map((k) => (
                <label key={k} className="edit-field">
                  <span>{k.replace("_", " ")}</span>
                  {k === "description" || k === "fit_summary"
                    ? <textarea value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
                    : <input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />}
                </label>
              ))}
              <div className="edit-actions">
                <button className="save" onClick={saveEdit}>save edits</button>
                <button onClick={() => setEditing(false)}>cancel</button>
              </div>
            </div>
          )}
          {askResearch && (
            <div className="research-req">
              <span>🔍 ask the agent to research this <em>e.g. "find the hiring manager + recent funding" or "couldn't slurp — structure this + find salary"</em></span>
              <textarea value={rNote} onChange={(e) => setRNote(e.target.value)} placeholder="what should the agent dig up?" />
              <button onClick={requestResearch}>request research</button>
              {job.research_status === "requested" && <span className="r-status">⏳ requested — the agent will research on its next run</span>}
            </div>
          )}
          {job.agent_research && (
            <details className="agent-research" open>
              <summary>🔍 agent research{job.research_done_at ? ` · ${fmt(job.research_done_at)}` : ""}</summary>
              <div className="ar-body">{job.agent_research}</div>
            </details>
          )}
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
