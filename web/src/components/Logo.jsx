import { markSvg } from "../favicon.js";

// The Orion-constellation mark, shared with the favicon (single source of truth
// in favicon.js). Renders the same art inline in the header. When `alerting`, it
// swaps to the hot (red) variant and pulses, in sync with the favicon blink.
export default function Logo({ size = 22, alerting = false }) {
  return (
    <span
      className={`logo${alerting ? " alerting" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markSvg(!!alerting) }}
    />
  );
}
