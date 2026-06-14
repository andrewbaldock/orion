import { markSvg } from "../favicon.js";

// The Orion-constellation mark, shared with the favicon (single source of truth
// in favicon.js). Renders the same art inline in the header.
export default function Logo({ size = 22 }) {
  return (
    <span
      className="logo"
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: markSvg(false) }}
    />
  );
}
