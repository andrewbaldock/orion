import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "./api.js";
import JobCard from "./components/JobCard.jsx";
import SlurpBar from "./components/SlurpBar.jsx";
import Settings from "./components/Settings.jsx";
import AddListing from "./components/AddListing.jsx";
import Logo from "./components/Logo.jsx";
import { startHotAlert, stopHotAlert, onAlertChange } from "./favicon.js";

// Two quick views Andrew wants front-and-center: "to review" = should-be-in-flight
// but isn't yet (status new), and "in flight" = anything actively in the pipeline.
// Then per-stage chips drill into in-flight statuses. Counts are merged into each
// chip so the old separate "stats" indicator row is no longer needed.
const QUICK_VIEWS = ["all", "to review", "in flight"];
const STAGE_FILTERS = ["interested", "applied", "phone_screen", "interview", "offer"];
const FILTER_LABELS = { all: "all", "to review": "to review", "in flight": "in flight", phone_screen: "phone screen" };
const IN_FLIGHT = ["interested", "applied", "phone_screen", "interview", "offer"];
const STAGE_RANK = Object.fromEntries(IN_FLIGHT.map((s, i) => [s, i]));
const ALERT_DEFAULTS = { hotJobBlink: true, flashTitle: true, hotScore: 60 };
const isBuriedJob = (jb) => jb.hidden || jb.status === "passed" || jb.status === "rejected";

export default function App() {
  const [tab, setTab] = useState("pipeline");
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [showBuried, setShowBuried] = useState(false);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [alerting, setAlerting] = useState(false);

  // Tracks which job ids we've already seen, so we only alert on genuinely NEW
  // hot jobs (null until the first load, which just seeds — no alert on startup).
  const seenRef = useRef(null);
  // Latest alert config from Settings; a ref so the poll closure always reads fresh.
  const alertsRef = useRef(ALERT_DEFAULTS);

  // Compare a fresh jobs payload against what we've seen and blink the favicon if a
  // new "hot" job (score >= configurable threshold) showed up.
  const detectHotJobs = useCallback((data) => {
    const a = alertsRef.current || ALERT_DEFAULTS;
    const threshold = Number.isFinite(a.hotScore) ? a.hotScore : 60;
    const hotIds = data.filter((jb) => !isBuriedJob(jb) && jb.score >= threshold).map((jb) => jb.id);
    if (seenRef.current === null) {                 // first load: seed only
      seenRef.current = new Set(data.map((jb) => jb.id));
      return;
    }
    const fresh = hotIds.filter((id) => !seenRef.current.has(id));
    data.forEach((jb) => seenRef.current.add(jb.id));
    if (fresh.length && a.hotJobBlink !== false) {
      const focused = document.visibilityState === "visible";
      startHotAlert(fresh.length, focused ? 5000 : 0, { flashTitle: a.flashTitle !== false });
    }
  }, []);

  // Always fetch hidden/passed too, so the "not interested" section count is honest;
  // it just lives in its own collapsed section below the viable list.
  const load = useCallback(() => {
    api.jobs({ includeHidden: true })
      .then((data) => { detectHotJobs(data); setJobs(data); })
      .catch((e) => setError(e.message));
    api.stats().then(setStats).catch(() => {});
    api.settings().then((c) => { if (c && c.alerts) alertsRef.current = c.alerts; }).catch(() => {});
  }, [detectHotJobs]);

  useEffect(() => { load(); }, [load]);

  // Keep the header logo's alert state in sync with the favicon blink.
  useEffect(() => { onAlertChange((on) => setAlerting(on)); }, []);

  // Auto-refresh so newly imported jobs appear without a manual reload: poll every
  // 60s, and refresh when the tab regains focus (cheap, and catches the common
  // "switch back to the tab" case immediately). load() only swaps the jobs array —
  // in-progress notes live in JobCard local state, so this won't clobber typing.
  useEffect(() => {
    const id = setInterval(load, 60_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") { stopHotAlert(); load(); }
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const onUpdate = async (id, fields) => {
    await api.updateJob(id, fields);
    load();
  };

  const isBuried = (jb) => jb.hidden || jb.status === "passed" || jb.status === "rejected";
  const matchesFilter = (jb) => {
    if (filter === "all") return true;
    if (filter === "to review") return jb.status === "new";
    if (filter === "in flight") return IN_FLIGHT.includes(jb.status);
    return jb.status === filter;
  };

  const active = jobs.filter((jb) => !isBuried(jb));
  // Count for a given chip — reflects how many viable cards it shows.
  const countFor = (f) => {
    if (f === "all") return active.length;
    if (f === "to review") return active.filter((jb) => jb.status === "new").length;
    if (f === "in flight") return active.filter((jb) => IN_FLIGHT.includes(jb.status)).length;
    return active.filter((jb) => jb.status === f).length;
  };

  const viable = active.filter(matchesFilter);
  const buried = jobs.filter((jb) => isBuried(jb) && (filter === "all" ? true : matchesFilter(jb)));

  // Split the viable list into the two quick views: "to review" (new, yellow) on
  // top, then "in flight" below sorted by pipeline stage so status reads at a
  // glance. Pinned jobs float to the top of whichever group they're in (server
  // already sorts pinned-first + score desc; these sorts are stable so that holds).
  const review = viable.filter((jb) => jb.status === "new");
  const inflight = viable
    .filter((jb) => IN_FLIGHT.includes(jb.status))
    .sort((a, b) => (b.pinned - a.pinned) || (STAGE_RANK[a.status] - STAGE_RANK[b.status]));
  const otherViable = viable.filter((jb) => jb.status !== "new" && !IN_FLIGHT.includes(jb.status));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo alerting={alerting} /> <b>Orion</b> <span className="tag">job hunt</span></div>
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
          <AddListing onAdded={load} />

          <div className="controls">
            <div className="filters views">
              {QUICK_VIEWS.map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {FILTER_LABELS[f] || f} <span className="count">{countFor(f)}</span>
                </button>
              ))}
              <span className="sep" />
              {STAGE_FILTERS.filter((f) => countFor(f) > 0).map((f) => (
                <button key={f} className={`stage ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
                  {FILTER_LABELS[f] || f} <span className="count">{countFor(f)}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="list">
            {viable.length === 0 && <p className="empty">No viable jobs yet. Paste a posting URL above, or let the hourly agent fill this in.</p>}

            {review.length > 0 && (filter === "all" || filter === "to review") && (
              <>
                <div className="group-head review-head">🟡 To review — not in flight yet ({review.length})</div>
                {review.map((jobb) => <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} onReload={load} />)}
              </>
            )}

            {inflight.length > 0 && (filter === "all" || filter === "in flight") && (
              <>
                <div className="group-head inflight-head">✈️ In flight ({inflight.length})</div>
                {inflight.map((jobb) => <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} onReload={load} />)}
              </>
            )}

            {/* A specific stage filter (or any leftover statuses) — flat list, no group headers. */}
            {filter !== "all" && filter !== "to review" && filter !== "in flight" &&
              viable.map((jobb) => <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} onReload={load} />)}

            {filter === "all" && otherViable.map((jobb) => (
              <JobCard key={jobb.id} job={jobb} onUpdate={onUpdate} onReload={load} />
            ))}
          </div>

          {buried.length > 0 && (
            <div className="buried-section">
              <button className="buried-toggle" onClick={() => setShowBuried((v) => !v)}>
                {showBuried ? "▾" : "▸"} Not interested / didn't get it ({buried.length})
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
