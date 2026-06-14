import { useEffect, useState } from "react";
import { api } from "../api.js";

// Settings page — every configurable that drives the search, scoring, and agent.
// Edits here change what the hourly agent hunts for (it reads this config each run).
export default function Settings() {
  const [cfg, setCfg] = useState(null);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { api.settings().then(setCfg).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="banner err">{err}</div>;
  if (!cfg) return <div className="settings"><p>Loading…</p></div>;

  const sp = cfg.searchProfile;
  const setSP = (patch) => setCfg({ ...cfg, searchProfile: { ...sp, ...patch } });

  const al = cfg.alerts || { hotJobBlink: true, flashTitle: true, hotScore: 60 };
  const setAL = (patch) => setCfg({ ...cfg, alerts: { ...al, ...patch } });

  const save = async () => {
    try { await api.saveSettings(cfg); setSaved(true); setTimeout(() => setSaved(false), 1500); }
    catch (e) { setErr(e.message); }
  };

  return (
    <div className="settings">
      <h2>Settings</h2>
      <p className="hint">These control what Orion searches for and how it ranks. The hourly agent reads this every run.</p>

      <section>
        <h3>Search profile</h3>
        <Field label="Keywords (one per line)">
          <textarea value={sp.keywords.join("\n")}
            onChange={(e) => setSP({ keywords: splitLines(e.target.value) })} />
        </Field>
        <Field label="Exclude keywords (one per line)">
          <textarea value={(sp.excludeKeywords || []).join("\n")}
            onChange={(e) => setSP({ excludeKeywords: splitLines(e.target.value) })} />
        </Field>
        <Field label="Bay Area cities (one per line)">
          <textarea value={sp.bayAreaCities.join("\n")}
            onChange={(e) => setSP({ bayAreaCities: splitLines(e.target.value) })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={sp.locations.bayAreaHybridOnsite}
            onChange={(e) => setSP({ locations: { ...sp.locations, bayAreaHybridOnsite: e.target.checked } })} />
          Include Bay Area hybrid / onsite
        </label>
        <label className="check">
          <input type="checkbox" checked={sp.locations.usRemote}
            onChange={(e) => setSP({ locations: { ...sp.locations, usRemote: e.target.checked } })} />
          Include US fully-remote
        </label>
      </section>

      <section>
        <h3>Priority employers</h3>
        <Field label="UC schools (one per line)">
          <textarea value={cfg.priorityEmployers.uc.join("\n")}
            onChange={(e) => setCfg({ ...cfg, priorityEmployers: { ...cfg.priorityEmployers, uc: splitLines(e.target.value) } })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={cfg.priorityEmployers.government}
            onChange={(e) => setCfg({ ...cfg, priorityEmployers: { ...cfg.priorityEmployers, government: e.target.checked } })} />
          Boost government / city / county roles
        </label>
        <label className="check">
          <input type="checkbox" checked={cfg.excludeStrugglingCompanies}
            onChange={(e) => setCfg({ ...cfg, excludeStrugglingCompanies: e.target.checked })} />
          Exclude struggling / shaky companies
        </label>
      </section>

      <section>
        <h3>Sources</h3>
        {cfg.sources.map((s, i) => (
          <div key={i} className="source-row">
            <input type="checkbox" checked={s.active}
              onChange={(e) => updateSource(cfg, setCfg, i, { active: e.target.checked })} />
            <input className="src-name" value={s.name}
              onChange={(e) => updateSource(cfg, setCfg, i, { name: e.target.value })} />
            <input className="src-url" value={s.url || ""}
              onChange={(e) => updateSource(cfg, setCfg, i, { url: e.target.value })} />
          </div>
        ))}
        <button className="add" onClick={() => setCfg({ ...cfg, sources: [...cfg.sources, { name: "", url: "", active: true }] })}>+ add source</button>
      </section>

      <section>
        <h3>Agent</h3>
        <Field label="Run interval (minutes)">
          <input type="number" value={cfg.agent.intervalMinutes}
            onChange={(e) => setCfg({ ...cfg, agent: { ...cfg.agent, intervalMinutes: Number(e.target.value) } })} />
        </Field>
        <Field label="Max top roles to surface">
          <input type="number" value={cfg.agent.maxTopRoles}
            onChange={(e) => setCfg({ ...cfg, agent: { ...cfg.agent, maxTopRoles: Number(e.target.value) } })} />
        </Field>
        <p className="hint">Note: changing the interval here updates the displayed value. To change the actual schedule, also update the scheduled task (see HANDOFF.md).</p>
      </section>

      <section>
        <h3>Alerts &amp; “hot” jobs</h3>
        <Field label="“Hot” score threshold — a job is hot at or above this score">
          <input type="number" value={al.hotScore}
            onChange={(e) => setAL({ hotScore: Number(e.target.value) })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={al.hotJobBlink !== false}
            onChange={(e) => setAL({ hotJobBlink: e.target.checked })} />
          Blink the favicon when a new hot job arrives
        </label>
        <label className="check">
          <input type="checkbox" checked={al.flashTitle !== false}
            onChange={(e) => setAL({ flashTitle: e.target.checked })} />
          Also flash the browser tab title
        </label>
        <p className="hint">“Hot” is defined purely by score (role match + location/remote fit + UC/gov priority + recency − health penalties). Raise the threshold for fewer, stronger alerts; lower it to be pinged on more.</p>
      </section>

      <div className="save-row">
        <button className="save" onClick={save}>Save settings</button>
        {saved && <span className="ok">✓ saved</span>}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
function splitLines(v) { return v.split("\n").map((s) => s.trim()).filter(Boolean); }
function updateSource(cfg, setCfg, i, patch) {
  const sources = cfg.sources.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
  setCfg({ ...cfg, sources });
}
