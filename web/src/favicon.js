// Orion favicon + tab-title controller.
//
// Two jobs:
//  1. Render the Orion-constellation mark (also reused as the header logo).
//  2. Blink the favicon + flash the tab title when a new HOT job arrives, so it
//     grabs attention even when Orion is a background tab.
//
// No deps, no storage. `markSvg(hot)` is the single source of truth for the art;
// the static /favicon.svg mirrors markSvg(false).

export function markSvg(hot = false) {
  const belt = hot ? "#ff5a52" : "#ffffff";
  const shoulder = hot ? "#ffb4a6" : "#ffd9a8";
  const halo = hot
    ? '<circle cx="32" cy="36" r="17" fill="#ff5a52" opacity="0.32"/>'
    : '<circle cx="32" cy="37" r="20" fill="#3a6bd0" opacity="0.22"/>';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="100%" height="100%" style="display:block">
  <defs>
    <radialGradient id="ob" cx="38%" cy="28%" r="88%">
      <stop offset="0" stop-color="#1d2a57"/><stop offset="0.55" stop-color="#121a38"/><stop offset="1" stop-color="#070b1c"/>
    </radialGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#ob)"/>
  ${halo}
  <g fill="#cdd9ff" opacity="0.5"><circle cx="12" cy="47" r="0.8"/><circle cx="53" cy="23" r="0.8"/><circle cx="49" cy="56" r="0.7"/><circle cx="16" cy="25" r="0.7"/><circle cx="56" cy="41" r="0.6"/></g>
  <g stroke="#7e97da" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" fill="none">
    <path d="M20 18 L43 15"/><path d="M20 18 L25 33"/><path d="M43 15 L39 39"/>
    <path d="M25 33 L32 36 L39 39"/><path d="M25 33 L22 50"/><path d="M39 39 L45 48"/>
  </g>
  <g>
    <circle cx="20" cy="18" r="2.6" fill="${shoulder}"/>
    <circle cx="43" cy="15" r="2.1" fill="#dce8ff"/>
    <circle cx="25" cy="33" r="2.4" fill="${belt}"/>
    <circle cx="32" cy="36" r="2.9" fill="${belt}"/>
    <circle cx="39" cy="39" r="2.4" fill="${belt}"/>
    <circle cx="22" cy="50" r="2.6" fill="#bcd2ff"/>
    <circle cx="45" cy="48" r="2.0" fill="#dce8ff"/>
  </g>
</svg>`;
}

const toUri = (s) => `data:image/svg+xml,${encodeURIComponent(s)}`;
const NORMAL = toUri(markSvg(false));
const ALERT = toUri(markSvg(true));

function iconLink() {
  let el = document.querySelector('link[rel="icon"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "icon");
    document.head.appendChild(el);
  }
  el.setAttribute("type", "image/svg+xml");
  return el;
}

function setIcon(href) { iconLink().setAttribute("href", href); }

let timer = null;
let baseTitle = typeof document !== "undefined" ? document.title : "Orion";

// Let the UI (e.g. the header Logo) react to alert start/stop in sync with the
// favicon. Register one listener; it's called with (isAlerting, count).
let listener = null;
export function onAlertChange(cb) { listener = cb; }

// Start blinking. If autoStopMs > 0 the alert clears itself after that long
// (used when the tab is already focused — a quick pulse, not a nag).
// opts.flashTitle (default true) also flashes the tab title text.
export function startHotAlert(count = 1, autoStopMs = 0, opts = {}) {
  const flashTitle = opts.flashTitle !== false;
  if (baseTitle === null) baseTitle = document.title;
  if (timer) clearInterval(timer);
  const label = `${count} hot ${count > 1 ? "jobs" : "job"}`;
  let on = false;
  const tick = () => {
    on = !on;
    setIcon(on ? ALERT : NORMAL);
    if (flashTitle) document.title = on ? `\u{1F534} ${label} — Orion` : baseTitle;
  };
  tick();
  timer = setInterval(tick, 650);
  if (listener) listener(true, count);
  if (autoStopMs > 0) setTimeout(stopHotAlert, autoStopMs);
}

export function stopHotAlert() {
  if (timer) { clearInterval(timer); timer = null; }
  setIcon(NORMAL);
  if (baseTitle !== null) document.title = baseTitle;
  if (listener) listener(false, 0);
}
