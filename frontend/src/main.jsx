import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Side effect: registers the beforeinstallprompt capture. This must happen
// before the first render, because the event fires once per engagement and is
// only cancelable while something is already listening. See pwa/install.js.
import './pwa/install.js';
import App from './App.jsx';

/*
 * Style load order:
 *   1. silk.css      — structural utilities + Material Symbols import
 *                      (tokens are now retro-flavoured stubs, not dark silk)
 *   2. retro.css     — Win95 token layer, @keyframes, bevel primitives,
 *                      bg-tile body rule (overrides silk body)
 *   3. retro-landing.css — .lp-*, .doc-*, .sys-* page styles
 *   4. retro-auth.css    — .si-* sign-in styles
 *   5. retro-mail.css    — .mail-shell, .topbar, .rail, .feed, .work, etc.
 *
 * The old landing.css / auth.css / mail.css files are intentionally NOT
 * imported — they carry dark neomorphic rules that would conflict.
 */
import './styles/silk.css';
import './styles/retro.css';
import './styles/retro-landing.css';
import './styles/retro-auth.css';
import './styles/retro-mail.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
