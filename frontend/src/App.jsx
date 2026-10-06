import { Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import System from './pages/System.jsx';
import Docs from './pages/Docs.jsx';
import Legal from './pages/Legal.jsx';

/**
 * Routes:
 *   /        marketing landing + download page
 *   /system  live deployment state
 *   /docs    how it actually works
 *   /terms   /privacy
 *
 * The app is no longer web-hosted. The Android APK is the product
 * (mobile/MOBILE-STRATEGY.md); /app and /signin were removed.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/system" element={<System />} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/terms" element={<Legal kind="terms" />} />
      <Route path="/privacy" element={<Legal kind="privacy" />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
