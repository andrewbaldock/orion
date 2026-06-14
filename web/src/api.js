// Thin API client. All calls hit the Bun backend (proxied in dev).
const j = async (res) => {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};

export const api = {
  jobs: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return fetch(`/api/jobs${q ? "?" + q : ""}`).then(j);
  },
  job: (id) => fetch(`/api/jobs/${id}`).then(j),
  updateJob: (id, fields) =>
    fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    }).then(j),
  reassessHealth: (id) =>
    fetch(`/api/jobs/${id}/health`, { method: "POST" }).then(j),
  slurp: (url) =>
    fetch("/api/slurp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    }).then(j),
  stats: () => fetch("/api/stats").then(j),
  settings: () => fetch("/api/settings").then(j),
  saveSettings: (cfg) =>
    fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(cfg),
    }).then(j),
};
