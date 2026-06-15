import { useState } from "react";
import { api } from "../api.js";

// Manual "+ Add listing" — for jobs Andrew already applied to, or ones slurp couldn't
// pull. Posts with source:"manual" (exempt from auto-purge). url is optional.
const FIELDS = ["title", "company", "location", "work_mode", "salary", "url", "description"];

export default function AddListing({ onAdded }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ work_mode: "remote" });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!f.title && !f.company) return;
    setBusy(true);
    try {
      await api.addJob({ ...f, source: "manual" });
      setF({ work_mode: "remote" }); setOpen(false); onAdded?.();
    } catch (e) { alert("Add failed: " + e.message); }
    finally { setBusy(false); }
  };

  if (!open) return <button className="add-listing-toggle" onClick={() => setOpen(true)}>+ Add listing manually</button>;
  return (
    <div className="add-listing">
      <div className="al-head">Add a listing manually</div>
      {FIELDS.map((k) => (
        <label key={k} className="al-field">
          <span>{k.replace("_", " ")}</span>
          {k === "description"
            ? <textarea value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            : <input value={f[k] || ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
        </label>
      ))}
      <div className="al-actions">
        <button className="save" onClick={submit} disabled={busy}>{busy ? "adding…" : "add listing"}</button>
        <button onClick={() => setOpen(false)}>cancel</button>
      </div>
    </div>
  );
}
