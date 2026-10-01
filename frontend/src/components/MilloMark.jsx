/**
 * Millo — the copilot's mark. Retro palette edition.
 *
 * The gradient now uses Win95 navy → blue rather than the Silk lavender/indigo.
 * The envelope + pulse motif is preserved; it is still drawn rather than
 * imported, so it inherits the current context colour for the surrounding icon.
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
        {/* Win95 titlebar navy → bright blue gradient */}
        <linearGradient id="millo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#000080" />
          <stop offset="100%" stopColor="#1084d0" />
        </linearGradient>
        {/* Bright pulse line — lime green to match hit-counter */}
        <linearGradient id="millo-p" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#00ff00" />
          <stop offset="100%" stopColor="#00aa00" />
        </linearGradient>
      </defs>

      {/* Envelope body — mail assistant identity */}
      <rect
        x="3" y="8" width="26" height="17"
        fill="url(#millo-g)"
        opacity="0.9"
      />

      {/* Envelope flap fold line */}
      <path
        d="M4.5 10.5 16 18.5l11.5-8"
        stroke="#ffffff"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />

      {/* The pulse line — something is running behind the mail */}
      <path
        d="M21 4.5h2.5l1.2 3 1.2-3H28"
        stroke="url(#millo-p)"
        strokeWidth="2"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
    </svg>
  );
}
