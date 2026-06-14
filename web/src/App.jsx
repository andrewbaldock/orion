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
  const [showBuried, setShowBuried] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  // Always fetch hidden/passed too, so the "not interested" section count is honest;
  // it just lives in its own collapsed section below the viable list.
  const load = useCallback(() => {
    api.jobs({ includeHidden: true })
      .then(setJobs)
      .catch((e) => setError(e.message));
    api.stats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const onUpdate = async (id, fields) => {
    await api.updateJob(id, fields);
    load();
  };

  const isBuried = (jb) => jb.hidden || jb.status === "passed" || jb.status === "rejected";
  const matchesFilter = (jb) => (filter === "all" ? true : jb.status === filter);

  const viable = jobs.filter((jb) => !isBuried(jb) && matchesFilter(jb));
  const buried = jobs.filter((jb) => isBuried(jb) && matchesFilter(jb));

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
          </div>

          <div className="list">
            {viable.length === 0 && <p className="empty">No viable jobs yet. Paste a posting URL above, or let the hourly agent fill this in.</p>}
            {viable.map((jobb) => (
              <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} onReload={load} />
            ))}
          </div>

          {buried.length > 0 && (
            <div className="buried-section">
              <button className="buried-toggle" onClick={() => setShowBuried((v) => !v)}>
                {showBuried ? "▾" : "▸"} Not interested / passed ({buried.length})
              </button>
              {showBuried && (
                <div className="list">
                  {buried.map((jobb) => (
                    <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} onReload={load} />
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      )}
    </div>
  );
}
