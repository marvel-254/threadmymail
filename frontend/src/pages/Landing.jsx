/**
 * Landing — the public face.
 *
 * Built from the Stitch design's structure and voice: nav, hero with a live
 * product surface, capability breakdown, a before/after, the autonomy
 * controls, and a closing CTA.
 *
 * ── On the copy ──────────────────────────────────────────────────────────
 * The original mockup copy made specific, checkable claims that this build
 * cannot support, and marketing pages that promise things the product does not
 * do are worse than pages that promise less:
 *
 *   "SOC2 Type II Certified"          no audit has ever been done
 *   "Silk Vault Private Enclave"      no enclave; Cloudflare Workers + Neon
 *   "AWS Nitro Enclave" (preloader)   not deployed on AWS at all
 *   "Traverses 100,000+ past emails"  no vector index, no corpus
 *   "within 12 milliseconds"          fabricated precision
 *   "3.8 hours" / "14 minutes"        invented statistics
 *   "Gmail and Outlook"               Gmail only; the rest is unbuilt
 *   "quarantine filter", "SSN masking" neither exists
 *
 * Everything below is a capability that is actually present in the codebase.
 * Where a number is used it is a real one — 36 tools is the real tool count,
 * and it is a better line than a fabricated time saving.
 */
import { Link } from 'react-router-dom';
import MilloMark from '../components/MilloMark.jsx';

const NAV = [
  { href: '#capabilities', label: 'Capabilities' },
  { href: '#autonomy', label: 'Millo' },
  { href: '#shift', label: 'The shift' },
  { href: '#security', label: 'Security' },
];

const CAPABILITIES = [
  {
    icon: 'manage_search',
    title: 'Triage that runs itself',
    body: 'Give Millo a standing instruction — “clear the unread backlog each morning” — and it runs on a schedule, inside the same budget and the same audit trail as anything you ask for directly.',
  },
  {
    icon: 'account_tree',
    title: 'Thirty-six tools, one agent',
    body: 'Mail, calendar, tasks, memory. Millo chooses what to call and shows you the call before it counts. There is no public endpoint that invokes a tool directly.',
  },
  {
    icon: 'history',
    title: 'Every action, written down',
    body: 'Each thing Millo does lands in an activity log with the run that caused it. Reversible actions stay reversible; the rest are marked as such up front.',
  },
  {
    icon: 'tune',
    title: 'Your model, your key',
    body: 'Bring a key from any of fourteen providers, or point it at your own endpoint. Keys are encrypted with AES-GCM at rest and never leave the server in readable form.',
  },
];

const BEFORE = [
  'Unread threads stacked until the pile stopped meaning anything.',
  'Half an hour hunting for the contract that mentioned the same clause.',
  'The same three status emails rewritten, by hand, every single morning.',
  'No record of what any assistant did on your behalf.',
];

const AFTER = [
  'Millo drafts, files and follows up on a schedule you set.',
  'It searches what it has already seen and answers from the thread.',
  'Replies arrive in your voice, queued for one click.',
  'Every action is attributable to a run you can open and read.',
];

const GUARDRAILS = [
  {
    icon: 'power_settings_new',
    title: 'A kill switch that is always one click away',
    body: 'It sits in the top bar, not in a settings submenu. One press and the agent stops acting on its own. Manual runs stay available.',
  },
  {
    icon: 'visibility_off',
    title: 'Dry-run shadowing',
    body: 'Outbound actions can be held in shadow. Millo takes every step and writes it to the activity log, but sends nothing, until you lift the shadow.',
  },
  {
    icon: 'speed',
    title: 'Budgets and quiet hours',
    body: 'Skills carry a daily run cap, and a quiet window defers work to the morning rather than firing it at three in the night.',
  },
  {
    icon: 'lock',
    title: 'Encrypted at rest, never logged',
    body: 'Credentials are sealed with a key that never reaches the browser. Settings shows a fingerprint, never the key — not to you, and not to anyone debugging it.',
  },
];

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <Link to="/" className="lp-brand">
          <MilloMark size={26} />
          <span>ThreadMyMail</span>
        </Link>
        <nav className="lp-links" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>{n.label}</a>
          ))}
        </nav>
        <Link to="/app" className="btn btn-primary lp-cta">
          Open the app
          <span className="ms" aria-hidden="true">arrow_forward</span>
        </Link>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="eyebrow">Autonomous inbox intelligence</span>
            <h1 className="lp-h1">
              Your inbox, orchestrated by <em>Millo</em>.
            </h1>
            <p className="lp-lede">
              Millo triages what arrives, drafts what needs an answer and runs the
              follow-ups you keep forgetting — on a schedule, inside limits you
              set, with every action written down.
            </p>
            <div className="row lp-hero-actions">
              <Link to="/app" className="btn btn-primary">
                Open ThreadMyMail
                <span className="ms" aria-hidden="true">arrow_forward</span>
              </Link>
              <a href="#capabilities" className="btn btn-secondary">
                See what it does
              </a>
            </div>
            <p className="lp-fine">
              Bring your own model key. No account required to look around.
            </p>
          </div>

          <ProductSurface />
        </section>

        {/* ── Capabilities ─────────────────────────────────────────────── */}
        <section className="lp-section" id="capabilities">
          <h2 className="lp-h2">Under the hood</h2>
          <p className="lp-sub">
            Not a summary of what mail says. A system that does something about it.
          </p>
          <div className="lp-grid">
            {CAPABILITIES.map((c) => (
              <article className="card t-lift lp-card" key={c.title}>
                <span className="ms lp-card-icon" aria-hidden="true">{c.icon}</span>
                <h3 className="lp-card-title">{c.title}</h3>
                <p className="lp-card-body">{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Before / after ──────────────────────────────────────────── */}
        <section className="lp-section" id="shift">
          <h2 className="lp-h2">The shift to autonomy</h2>
          <p className="lp-sub">
            The work does not get faster because you got better at triaging. It gets
            faster because something else is doing it.
          </p>
          <div className="lp-ba">
            <div className="lp-ba-col lp-ba-before t-well">
              <div className="eyebrow">Doing it yourself</div>
              <ul className="lp-list">
                {BEFORE.map((b) => (
                  <li key={b}>
                    <span className="ms lp-x" aria-hidden="true">close</span>{b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-ba-col lp-ba-after t-raised">
              <div className="eyebrow lp-ok">With Millo</div>
              <ul className="lp-list">
                {AFTER.map((a) => (
                  <li key={a}>
                    <span className="ms lp-check" aria-hidden="true">check</span>{a}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Autonomy ─────────────────────────────────────────────────── */}
        <section className="lp-section" id="autonomy">
          <h2 className="lp-h2">Autonomy with the handbrake in view</h2>
          <p className="lp-sub">
            An assistant that acts on its own is only useful if stopping it is easier
            than trusting it. Every one of these controls is one click deep.
          </p>
          <div className="lp-grid">
            {GUARDRAILS.map((g) => (
              <article className="card t-lift lp-card" key={g.title}>
                <span className="ms lp-card-icon" aria-hidden="true">{g.icon}</span>
                <h3 className="lp-card-title">{g.title}</h3>
                <p className="lp-card-body">{g.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Security, honestly ───────────────────────────────────────── */}
        <section className="lp-section" id="security">
          <div className="lp-security card-float">
            <div className="lp-security-copy">
              <h2 className="lp-h2">What is actually true about your data</h2>
              <p className="lp-sub lp-sub-tight">
                No enclave, no SOC 2 badge, no certification. Here is the real
                architecture, including the part that is not finished.
              </p>
              <dl className="lp-facts">
                <div>
                  <dt>Where it runs</dt>
                  <dd>Cloudflare Workers and a Durable Object, with Postgres for state and D1 for message bodies.</dd>
                </div>
                <div>
                  <dt>Your model key</dt>
                  <dd>AES-GCM encrypted at rest under a key that never leaves the server. The API can decrypt it — this is not zero-knowledge, and it does not pretend to be.</dd>
                </div>
                <div>
                  <dt>Model providers</dt>
                  <dd>Your key goes to the provider you chose. Nothing is proxied through us.</dd>
                </div>
                <div>
                  <dt>Not built yet</dt>
                  <dd>Google account linking, so there is no mail to read. Everything else works against its own APIs today.</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ──────────────────────────────────────────────── */}
        <section className="lp-section lp-close">
          <h2 className="lp-h2">Stop reading it. Start orchestrating it.</h2>
          <p className="lp-sub">Built for people who already have too much mail.</p>
          <Link to="/app" className="btn btn-primary lp-cta-lg">
            Open ThreadMyMail
            <span className="ms" aria-hidden="true">arrow_forward</span>
          </Link>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="row">
          <MilloMark size={20} />
          <span>ThreadMyMail</span>
          <div className="spacer" />
          <Link to="/app">App</Link>
          <Link to="/system">System</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <span className="lp-build">Silk · dark</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * A still of the real product, built from the real primitives rather than an
 * image. It is the same three-pane layout the app uses, at rest.
 */
function ProductSurface() {
  return (
    <div className="lp-surface card-float" aria-hidden="true">
      <div className="lp-surface-bar">
        <span className="lp-dot" /><span className="lp-dot" /><span className="lp-dot" />
        <span className="lp-surface-title">ThreadMyMail</span>
      </div>
      <div className="lp-surface-body">
        <div className="lp-surface-rail">
          {['stream', 'today', 'bolt', 'psychology', 'extension'].map((i, n) => (
            <span className={`lp-surface-rail-item${n === 0 ? ' is-active' : ''}`} key={i}>
              <span className="ms" >{i}</span>
            </span>
          ))}
        </div>
        <div className="lp-surface-feed">
          {[0, 1, 2, 3].map((n) => (
            <div className="lp-surface-row" key={n} data-unread={n < 2} />
          ))}
        </div>
        <div className="lp-surface-work">
          <div className="lp-surface-ai">
            <span className="ms">auto_awesome</span>
            <div className="lp-surface-ai-lines">
              <i /><i /><i />
            </div>
          </div>
          <div className="lp-surface-bubble" />
          <div className="lp-surface-copilot">
            <span className="lp-surface-caret" />
          </div>
        </div>
      </div>
    </div>
  );
}
