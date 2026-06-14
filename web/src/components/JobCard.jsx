import { useState } from "react";

const PIPELINE = ["new", "interested", "applied", "phone_screen", "interview", "offer", "rejected", "passed"];

export default function JobCard({ job, onUpdate }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(job.notes || "");
  const reasons = safeParse(job.score_reasons);
  const buried = job.hidden || job.status === "passed" || job.status === "rejected";

  return (
    <div className={`card ${job.pinned ? "pinned" : ""} ${buried ? "buried" : ""} health-${job.health_flag}`}>
      <div className="card-head" onClick={() => setOpen(!open)}>
        <div className="score" title={reasons.join("\n")}>{Math.round(job.score)}</div>
        <div className="who">
          <div className="title">{job.title || "(untitled)"} {job.employer_type === "uc" && <span className="badge uc">UC</span>} {job.employer_type === "government" && <span className="badge gov">GOV</span>}</div>
          <div className="sub">{job.company || "—"} · {job.location || "?"} · <span className={`mode ${job.work_mode}`}>{job.work_mode}</span> · <span className="src">{job.source}</span></div>
        </div>
        <select className={`status s-${job.status}`} value={job.status}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onUpdate(job.id, { status: e.target.value })}>
          {PIPELINE.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>

      <div className="card-actions">
        {job.url && <a href={job.url} target="_blank" rel="noreferrer">open posting ↗</a>}
        <button onClick={() => onUpdate(job.id, { pinned: job.pinned ? 0 : 1 })}>{job.pinned ? "unpin" : "pin"}</button>
        <button onClick={() => onUpdate(job.id, { hidden: job.hidden ? 0 : 1 })}>{job.hidden ? "unhide" : "hide / sink"}</button>
        <button className="passed" onClick={() => onUpdate(job.id, { status: "passed" })}>not interested</button>
      </div>

      {open && (
        <div className="card-body">
          {job.salary && <p className="salary">💰 {job.salary}</p>}
          {job.health_flag !== "ok" && <p className="health">⚠ {job.health_flag}: {job.health_notes || "flagged"}</p>}
          <p className="desc">{job.description || "No description."}</p>
          {reasons.length > 0 && (
            <details><summary>why this score</summary><ul>{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></details>
          )}
          <label className="notes">
            <span>your notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== job.notes && onUpdate(job.id, { notes })} />
          </label>
          <div className="meta">first seen {fmt(job.first_seen_at)} · last seen {fmt(job.last_seen_at)}</div>
        </div>
      )}
    </div>
  );
}

function safeParse(s) { try { return JSON.parse(s) || []; } catch { return []; } }
function fmt(d) { return d ? new Date(d.replace(" ", "T") + "Z").toLocaleDateString() : "—"; }
