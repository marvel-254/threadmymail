/**
 * Legal — Terms and Privacy. 90s Nostalgia edition.
 * Win95 window sections, groove HR, yellow info panel.
 */
import { Link } from 'react-router-dom';

const TERMS = [
  ['Your account', 'ThreadMyMail is currently intended for the account owner\'s personal use. Sign in with your own Google account and keep your sign-in and model-provider credentials secure. You are responsible for activity performed through your account.'],
  ['Google access', 'The current Google connection requests identity information and read-only Gmail and Calendar access. Mail and calendar actions such as sending, changing, or deleting items are not enabled by this connection. You can revoke access in your Google Account settings.'],
  ['AI providers', 'If you use an AI feature, relevant prompts and app context are sent to the model provider you select. You are responsible for reviewing that provider\'s terms, privacy practices, and charges. ThreadMyMail does not provide or pay for your model-provider account.'],
  ['Acceptable use', 'Use ThreadMyMail only with accounts and information you are authorized to access. Do not use it to violate another service\'s terms, send unlawful or unsolicited communications, or interfere with the service.'],
  ['Availability and changes', 'The service is provided as-is and may change, be interrupted, or be unavailable. Features are under active development; descriptions in the app and documentation explain current limitations.'],
  ['Contact', 'For questions about these terms, use the support contact shown on the ThreadMyMail Google consent screen.'],
];

const PRIVACY = [
  ['Information collected', 'When you sign in, Google provides your account identifier, email address, and profile name. ThreadMyMail also stores information you add or generate in the app, such as settings, model-provider configuration, tasks, skills, activity records, and agent conversations.'],
  ['Google account data', 'The connection requests OpenID identity, email, profile, Gmail read-only, and Calendar read-only scopes. OAuth access and refresh tokens are stored encrypted at rest. In the current release, Gmail and Calendar tools are not yet implemented, so mailbox messages and calendar events are not imported or acted on.'],
  ['How information is used', 'Account information is used to sign you in and scope your data to your account. App data supports the features you use. If you use an AI feature, relevant prompts and app context are sent to the model provider configured for your account. Google tokens maintain your connection and may be used only for the Google features and read-only access you authorize. ThreadMyMail does not sell Google user data or use it for advertising.'],
  ['Service providers and storage', 'ThreadMyMail runs on Cloudflare and Neon infrastructure. Google processes sign-in and any authorized Google API requests. Your selected AI provider processes requests sent to its model. These providers handle data as needed to provide their services under their own terms and privacy policies.'],
  ['Security', 'Google OAuth tokens and model-provider keys are encrypted at rest by the service. The service must be able to decrypt tokens and keys to use them. No security measure can guarantee absolute security.'],
  ['Your choices and retention', 'You can sign out, remove a stored model-provider key, or revoke ThreadMyMail\'s Google access from your Google Account. The current app does not have self-service account or data deletion; contact the support email shown on the Google consent screen to request help with data deletion.'],
  ['Contact and updates', 'For privacy questions, use the support contact shown on the ThreadMyMail Google consent screen. This policy may be updated as the app\'s features and data practices change; the date below indicates its latest revision.'],
];

export default function Legal({ kind = 'terms' }) {
  const isTerms = kind === 'terms';
  const rows = isTerms ? TERMS : PRIVACY;

  return (
    <div className="doc">
      <header className="doc-head">
        <span className="r-eyebrow">{isTerms ? 'Terms' : 'Privacy'}</span>
        <h1 className="lp-h1" style={{ fontSize: '28px', textShadow: '2px 2px 0 #808080' }}>
          {isTerms ? 'Terms of service' : 'Privacy policy'}
        </h1>
        <p className="lp-sub">
          {isTerms
            ? 'Terms for using ThreadMyMail.'
            : 'What ThreadMyMail collects, how it is used, and the choices available to you.'}
        </p>
      </header>

      {/* Info panel */}
      <div className="doc-alert">
        <span className="ms" aria-hidden="true">info</span>
        <p>
          {isTerms
            ? 'ThreadMyMail is an active, evolving service. Review the current feature limits and Google access described below before using it.'
            : 'ThreadMyMail requires sign-in. The current Google connection is read-only, and Gmail and Calendar tools are not yet available in the app.'}
        </p>
      </div>

      <section className="doc-sec">
        <h2 className="lp-h2" style={{ fontSize: '18px' }}>
          {isTerms ? 'Terms' : 'Privacy'}
        </h2>
        {rows.map(([h, b]) => (
          <div className="doc-clause" key={h}>
            <h2>{h}</h2>
            <p>{b}</p>
          </div>
        ))}
      </section>

      <hr className="hr-groove" aria-hidden="true" />

      <section className="doc-sec">
        <h2 className="lp-h2" style={{ fontSize: '18px' }}>References</h2>
        <p className="doc-note">
          Last updated 1 October 2026.
          {' '}<Link to="/docs">How the system works</Link>,{' '}
          <Link to="/system">deployment state</Link>.
        </p>
      </section>
    </div>
  );
}
