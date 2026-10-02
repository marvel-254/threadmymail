/**
 * Millo — the app's logo mark.
 *
 * Renders the desired-logo image at the requested size. Used everywhere a
 * branded mark appears: sign-in avatar, shell loading state, nav, footer.
 *
 * The image is square (desired-logo.jpeg is 1280×1280) so width === height
 * at every usage site. object-fit: cover handles any edge case where the
 * container is not perfectly square.
 */
export default function MilloMark({ size = 28, title = 'Millo' }) {
  return (
    <img
      src="/logo.svg"
      alt={title}
      width={size}
      height={size}
      aria-label={title}
      className="millo-mark"
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        display: 'inline-block',
        verticalAlign: 'middle',
      }}
    />
  );
}
