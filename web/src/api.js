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
  addJob: (fields) =>
    fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) }).then(j),
  updateJob: (id, fields) =>
    fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    }).then(j),
  reassessHealth: (id) =>
    fetch(`/api/jobs/${id}/health`, { method: "POST" }).then(j),
  verifyPosting: (id) =>
    fetch(`/api/jobs/${id}/verify`, { method: "POST" }).then(j),
  avoid: () => fetch("/api/avoid").then(j),
  blockCompany: (company, reason, scope) =>
    fetch("/api/avoid/company", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company, reason, scope }) }).then(j),
  unblockCompany: (company) =>
    fetch("/api/avoid/company", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ company }) }).then(j),
  saveAvoid: (avoid) =>
    fetch("/api/avoid", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(avoid) }).then(j),
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
