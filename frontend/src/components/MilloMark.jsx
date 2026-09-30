/**
 * Millo — the copilot's mark.
 *
 * Drawn rather than imported so it inherits the current palette and stays crisp
 * at any size. The designs shipped raster avatars (screen.png); a 1px SVG line
 * is sharper on the OLED-dark surfaces this app is read on, and costs nothing
 * to load.
 */
export default function MilloMark({ size = 28, title = 'Millo' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      role="img"
      aria-label={title}
      className="millo-mark"
    >
      <defs>
        <linearGradient id="millo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c0c1ff" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      {/* Envelope — it is a mail assistant. */}
      <rect x="3" y="8" width="26" height="17" rx="4" fill="url(#millo-g)" opacity="0.22" />
      <path
        d="M4.5 10.5 16 18.5l11.5-8"
        stroke="url(#millo-g)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* The pulse, offset up-right: something running behind the mail. */}
      <path
        d="M21 4.5h2.5l1.2 3 1.2-3H28"
        stroke="#7bd0ff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
