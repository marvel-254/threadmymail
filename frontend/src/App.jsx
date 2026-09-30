import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import SignIn from './pages/SignIn.jsx';
import System from './pages/System.jsx';
import Docs from './pages/Docs.jsx';
import Legal from './pages/Legal.jsx';
import MailShell from './mail/MailShell.jsx';

/**
 * Routes:
 *   /        marketing landing page
 *   /signin  account access
 *   /app     the three-pane workspace
 *   /system  live deployment state
 *   /docs    how it actually works
 *   /terms   /privacy
 *
 * /app is still ungated. `api.me()` 404s until Google OAuth is built, so a hard
 * gate would make the app permanently unreachable rather than private. This is
 * the single largest open risk on a publicly deployed build — see HANDOFF.md.
 */
export default function App() {
  const location = useLocation();

  return (
    <Routes location={location}>
      <Route path="/" element={<Landing />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/app" element={<MailShell />} />
      <Route path="/system" element={<System />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/terms" element={<Legal kind="terms" />} />
      <Route path="/privacy" element={<Legal kind="privacy" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
