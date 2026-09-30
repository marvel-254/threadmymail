import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Side effect: registers the beforeinstallprompt capture. This must happen
// before the first render, because the event fires once per engagement and is
// only cancelable while something is already listening. See pwa/install.js.
import './pwa/install.js';
import App from './App.jsx';
import './styles/silk.css';
import './styles/mail.css';
import './styles/landing.css';
import './styles/auth.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
