/**
 * Terms and Privacy.
 *
 * Not legal advice, and not a lawyer's copy. These pages exist because a public
 * URL owes visitors an accurate description of what happens to their data, and
 * because the mockup's versions described a product with a private enclave and a
 * SOC 2 badge that this build does not have.
 *
 * The most important disclosure is in the first paragraph of each: there is no
 * authentication, so there is no meaningful privacy boundary between accounts —
 * because there is only one account, and anyone with the link is inside it.
 */
import { Link } from 'react-router-dom';

const TERMS = [
  ['No warranty', 'The service is provided as-is, with no guarantee of availability, correctness or fitness for any purpose. It is a working build, not a finished product.'],
  ['Your accounts, your risk', 'You are responsible for the model provider keys you supply and for anything sent to them. A key you paste is a key you own, including any spend it incurs.'],
  ['Outbound actions', 'The agent can draft, file and, where you enable it, send. Read what it is about to do. Dry-run shadowing exists for exactly this reason.'],
  ['Acceptable use', 'Do not use this to send unsolicited bulk mail, to circumvent a provider’s terms, or to process mail you have no right to read.'],
  ['No liability', 'To the extent permitted by law, the authors are not liable for lost mail, lost data, or lost spend.'],
];

const PRIVACY = [
  ['What is stored', 'Your provider keys (encrypted at rest), your settings, your skills, your tasks, and the run history needed to show you what the agent did. Message bodies are held separately in D1 when mail is connected.'],
  ['Who can read it', 'Right now, anyone who has the app URL. There is no login. CORS limits which browser can make the request; it is not an access control. Treat the link as a shared password until Google sign-in ships.'],
  ['What leaves the machine', 'Only what you send to the model provider you configured, when the agent takes a turn. Content is not routed through any third party we operate, and there is no analytics or telemetry in this build.'],
  ['Encryption is not secrecy from us', 'Keys are sealed with AES-GCM using a key derived from ENCRYPTION_KEY. The server can decrypt them, because it has to. This is encryption at rest, not zero-knowledge, and it is not described as such.'],
  ['Deletion', 'Removing a provider deletes its stored key. There is no self-service account deletion yet, because there is no account to delete.'],
];

export default function Legal({ kind = 'terms' }) {
  const isTerms = kind === 'terms';
  const rows = isTerms ? TERMS : PRIVACY;

  return (
    <div className="doc">
      <header className="doc-head">
        <span className="eyebrow">{isTerms ? 'Terms' : 'Privacy'}</span>
        <h1 className="lp-h1" style={{ fontSize: 32 }}>
          {isTerms ? 'Terms of service' : 'Privacy policy'}
        </h1>
        <p className="lp-sub">
          {isTerms
            ? 'Plain terms for a service that is still being built.'
            : 'A short and accurate account of what happens to your data. It is shorter than a real privacy policy because this is not a real business yet.'}
        </p>
      </header>

      {/*
        The disclosure that matters most, stated at the top rather than buried
        in a subheading.
      */}
      <div className="doc-alert">
        <span className="ms" aria-hidden="true">info</span>
        <p>
          {isTerms
            ? 'There is no authentication on this deployment. Anyone with the link can use the account.'
            : 'There is no authentication on this deployment, so "your data" currently means "whatever anyone with the link does". Google sign-in is the next piece of work.'}
        </p>
      </div>

      <section className="doc-sec">
        {rows.map(([h, b]) => (
          <div className="doc-clause" key={h}>
            <h2>{h}</h2>
            <p>{b}</p>
          </div>
        ))}
      </section>

      <section className="doc-sec">
        <p className="doc-note">
          Last written against the deployed build on 30 September 2026.
          {' '}<Link to="/docs">How the system works</Link>,{' '}
          <Link to="/system">deployment state</Link>.
        </p>
      </section>
    </div>
  );
}
