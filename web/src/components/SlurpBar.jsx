import { useState } from "react";
import { api } from "../api.js";

// Paste a job-posting URL -> Orion fetches, parses, scores, and stores it.
export default function SlurpBar({ onSlurped }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const go = async () => {
    if (!url.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const { job, created } = await api.slurp(url.trim());
      setMsg(`${created ? "Added" : "Updated"}: ${job.title || job.url}`);
      setUrl("");
      onSlurped?.();
    } catch (e) {
      setMsg("Couldn't slurp that URL: " + e.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="slurp">
      <input
        type="url"
        placeholder="Paste a job posting URL to slurp it in…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
      />
      <button onClick={go} disabled={busy}>{busy ? "slurping…" : "Slurp"}</button>
      {msg && <span className="slurp-msg">{msg}</span>}
    </div>
  );
}
