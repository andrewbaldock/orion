import { useEffect, useState, useCallback } from "react";
import { api } from "./api.js";
import JobCard from "./components/JobCard.jsx";
import SlurpBar from "./components/SlurpBar.jsx";
import Settings from "./components/Settings.jsx";

const STATUS_FILTERS = ["all", "new", "interested", "applied", "interview", "offer"];

export default function App() {
  const [tab, setTab] = useState("pipeline");
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [showHidden, setShowHidden] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.jobs({ includeHidden: showHidden })
      .then(setJobs)
      .catch((e) => setError(e.message));
    api.stats().then(setStats).catch(() => {});
  }, [showHidden]);

  useEffect(() => { load(); }, [load]);

  const onUpdate = async (id, fields) => {
    await api.updateJob(id, fields);
    load();
  };

  const visible = jobs.filter((jobb) =>
    filter === "all" ? true : jobb.status === filter);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">🌌 <b>Orion</b> <span className="tag">job hunt</span></div>
        <nav>
          <button className={tab === "pipeline" ? "on" : ""} onClick={() => setTab("pipeline")}>Pipeline</button>
          <button className={tab === "settings" ? "on" : ""} onClick={() => setTab("settings")}>Settings</button>
        </nav>
      </header>

      {error && <div className="banner err">{error}</div>}

      {tab === "settings" ? (
        <Settings />
      ) : (
        <main className="pipeline">
          <SlurpBar onSlurped={load} />

          {stats && (
            <div className="stats">
              <span><b>{stats.total}</b> tracked</span>
              {stats.byStatus.map((s) => (
                <span key={s.status} className={`chip s-${s.status}`}>{s.status}: {s.n}</span>
              ))}
            </div>
          )}

          <div className="controls">
            <div className="filters">
              {STATUS_FILTERS.map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
            <label className="toggle">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              show hidden / passed
            </label>
          </div>

          <div className="list">
            {visible.length === 0 && <p className="empty">No jobs yet. Paste a posting URL above, or let the hourly agent fill this in.</p>}
            {visible.map((jobb) => (
              <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} />
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
