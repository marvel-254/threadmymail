import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import SignIn from './pages/SignIn.jsx';
import System from './pages/System.jsx';
import Docs from './pages/Docs.jsx';
import Legal from './pages/Legal.jsx';
import MailShell from './mail/MailShell.jsx';
import RequireSession from './mail/RequireSession.jsx';
import InstallBanner from './pwa/InstallBanner.jsx';

/**
 * Routes:
 *   /        marketing landing page
 *   /signin  account access
 *   /app     the three-pane workspace  (gated)
 *   /system  live deployment state
 *   /docs    how it actually works
 *   /terms   /privacy
 *
 * /app is gated on a valid session. Previously it was open, which meant the
 * published URL was one shared account: todos, skills and the credential store
 * were available to anyone who had the link. The gate in the UI is convenience;
 * the real enforcement is in the Worker, where every route resolves a user from
 * a signed cookie and returns 401 otherwise.
 *
 * The gate also passes through when the API reports dev_mode, so a local Worker
 * running without auth is still usable.
 */
export default function App() {
  return (
    <>
      <InstallBanner />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<SignIn />} />
        <Route
          path="/app"
          element={
            <RequireSession>
              <MailShell />
            </RequireSession>
          }
        />
        <Route path="/system" element={<System />} />
        <Route path="/docs" element={<Docs />} />
        <Route path="/terms" element={<Legal kind="terms" />} />
        <Route path="/privacy" element={<Legal kind="privacy" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
