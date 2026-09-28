import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import SignIn from './pages/SignIn.jsx';
import AppShell from './app/AppShell.jsx';

/**
 * Routes:
 *   /        marketing landing page (preserved)
 *   /signin  Google consent
 *   /app     the agent shell
 *
 * Phase 1+ should gate /app behind api.me(). That is deliberately not done here:
 * the Worker does not exist yet, so a hard gate would make the shell unreachable
 * and impossible to review. See docs/PLAN.md Phase 1.
 */
export default function App() {
  const location = useLocation();

  return (
    <Routes location={location}>
      <Route path="/" element={<Landing />} />
      <Route path="/signin" element={<SignIn />} />
      <Route path="/app" element={<AppShell />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
