/**
 * DocNav — sticky top bar for documentation / system / legal pages.
 *
 * Provides a "← Home" back button and a page title in the Win95 toolbar style.
 * Used on every standalone page that has no shell nav of its own.
 */
import { Link, useNavigate } from 'react-router-dom';

export default function DocNav({ title, links }) {
  const navigate = useNavigate();

  return (
    <nav className="doc-nav" aria-label="Page navigation">
      <button
        type="button"
        className="r-btn doc-nav__back"
        onClick={() => navigate(-1)}
        aria-label="Go back"
      >
        <span className="ms" aria-hidden="true">arrow_back</span>
        Back
      </button>

      <Link to="/" className="doc-nav__home r-btn">
        <span className="ms" aria-hidden="true">home</span>
        Home
      </Link>

      <span className="doc-nav__title" aria-current="page">{title}</span>

      {links && links.length > 0 && (
        <div className="doc-nav__links">
          {links.map(({ to, label }) => (
            <Link key={to} to={to} className="doc-nav__link">
              {label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
