/**
 * Landing — the public face. 90s Nostalgia edition.
 *
 * Structure is unchanged; only className values and a few wrapping elements
 * added for the retro mandatory elements:
 *   - Announcement marquee bar (top)
 *   - Rainbow animated h1 <em>
 *   - NEW! pulse badge
 *   - Hit-counter style stats bar
 *   - Construction stripe closing CTA
 *   - Decorative color squares
 *   - Groove HR dividers
 */
import { Link } from 'react-router-dom';
import Marquee from 'react-fast-marquee';
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
    body: 'Give Millo a standing instruction — "clear the unread backlog each morning" — and it runs on a schedule, inside the same budget and the same audit trail as anything you ask for directly.',
  },
  {
    icon: 'account_tree',
    title: 'Mail, chat, and the agent',
    body: 'Inbox, thread view, and the agent conversation side by side. Millo reads what arrives, drafts what needs an answer, and shows you every call it makes.',
  },
  {
    icon: 'history',
    title: 'Every action, written down',
    body: 'Each thing Millo does lands in an activity log with the run that caused it. Reversible actions stay reversible; the rest are marked as such up front.',
  },
  {
    icon: 'tune',
    title: 'Your model, your key',
    body: 'Bring a key from any OpenAI-compatible provider, or point it at your own endpoint. Keys live in the phone\'s encrypted secure store and never leave the device.',
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

const MARQUEE_ITEMS = [
  { text: '★ AUTONOMOUS EMAIL INTELLIGENCE', color: '#ffff00' },
  { text: '● ON-DEVICE, NO SERVER', color: '#00ff00' },
  { text: '★ BRING YOUR OWN MODEL KEY', color: '#ff8000' },
  { text: '● IMAP + SMTP APP PASSWORD', color: '#00ffff' },
  { text: '★ KILL SWITCH ALWAYS VISIBLE', color: '#ff0000' },
  { text: '● ACTIVITY LOG FOR EVERY ACTION', color: '#ff80ff' },
  { text: '★ CREDENTIALS NEVER LEAVE YOUR PHONE', color: '#ffff00' },
];

const COLOR_SQUARES = [
  '#ff0000', '#ff8000', '#ffff00', '#00ff00',
  '#00ffff', '#0000ff', '#8000ff', '#ff00ff',
];

export default function Landing() {
  return (
    <div className="lp">
      {/* ── Announcement marquee ───────────────────────────────────────── */}
      <div className="lp-marquee-bar" role="marquee" aria-label="Announcements">
        <Marquee speed={45} gradient={false} pauseOnHover>
          {MARQUEE_ITEMS.map((item, i) => (
            <span
              key={i}
              className="marquee-item"
              style={{ color: item.color }}
            >
              {item.text}
              <span className="marquee-sep" aria-hidden="true"> ◆ </span>
            </span>
          ))}
        </Marquee>
      </div>

      <header className="lp-nav">
        <Link to="/" className="lp-brand">
          <MilloMark size={22} />
          <span>ThreadMyMail</span>
        </Link>
        <nav className="lp-links" aria-label="Sections">
          {NAV.map((n) => (
            <a key={n.href} href={n.href}>{n.label}</a>
          ))}
        </nav>
        <a
          href="https://github.com/marvel-254/threadmymail/releases/latest/download/app-release.apk"
          className="btn btn-primary lp-cta"
          download
        >
          Download for Android
          <span className="ms" aria-hidden="true">download</span>
        </a>
      </header>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span className="r-eyebrow">Autonomous inbox intelligence</span>
              <span className="r-badge-new" aria-label="New">NEW!</span>
            </div>
            <h1 className="lp-h1">
              Your inbox, orchestrated by <em className="text-rainbow">Millo</em>.
            </h1>
            <p className="lp-lede">
              Millo triages what arrives, drafts what needs an answer and runs the
              follow-ups you keep forgetting — on your phone, inside limits you
              set, with every action written down. No server, no account, no cloud.
            </p>
            <div className="row lp-hero-actions">
              <a
                href="https://github.com/marvel-254/threadmymail/releases/latest/download/app-release.apk"
                className="btn btn-primary"
                download
              >
                Download for Android
                <span className="ms" aria-hidden="true">download</span>
              </a>
              <a href="#capabilities" className="btn btn-secondary">
                See what it does
              </a>
            </div>
            <p className="lp-fine">
              Bring your own model key. Your credentials never leave your phone.
            </p>

            {/* Decorative color squares */}
            <div className="r-color-grid" style={{ marginTop: '12px' }} aria-hidden="true">
              {COLOR_SQUARES.map((c) => (
                <div key={c} className="r-color-sq" style={{ background: c }} />
              ))}
            </div>
          </div>

          <ProductSurface />
        </section>

        {/* ── Groove divider ───────────────────────────────────────────── */}
        <hr className="hr-groove" aria-hidden="true" />

        {/* ── Hit counter stats bar ────────────────────────────────────── */}
        <div className="lp-stats-bar" aria-label="Product stats">
          <div className="lp-stat-item">
            <span className="lp-stat-value">0000</span>
            <span className="lp-stat-label">Servers to run</span>
          </div>
          <div className="lp-stat-item">
            <span className="lp-stat-value">0006</span>
            <span className="lp-stat-label">AI providers</span>
          </div>
          <div className="lp-stat-item">
            <span className="lp-stat-value">$0.00</span>
            <span className="lp-stat-label">Infra cost / month</span>
          </div>
          <div className="lp-stat-item">
            <span className="lp-stat-value">01997</span>
            <span className="lp-stat-label">Vibes (since)</span>
          </div>
        </div>

        {/* ── Groove divider ───────────────────────────────────────────── */}
        <hr className="hr-groove" aria-hidden="true" />

        {/* ── Capabilities ─────────────────────────────────────────────── */}
        <section className="lp-section" id="capabilities">
          <h2 className="lp-h2">Under the hood</h2>
          <p className="lp-sub">
            Not a summary of what mail says. A system that does something about it.
          </p>
          <div className="lp-grid">
            {CAPABILITIES.map((c) => (
              <article className="lp-card" key={c.title}>
                <div className="lp-card-icon">
                  <span className="ms" aria-hidden="true">{c.icon}</span>
                </div>
                <h3 className="lp-card-title">{c.title}</h3>
                <p className="lp-card-body">{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        <hr className="hr-groove" aria-hidden="true" />

        {/* ── Before / after ──────────────────────────────────────────── */}
        <section className="lp-section" id="shift">
          <h2 className="lp-h2">The shift to autonomy</h2>
          <p className="lp-sub">
            The work does not get faster because you got better at triaging. It gets
            faster because something else is doing it.
          </p>
          <div className="lp-ba">
            <div className="lp-ba-col lp-ba-before">
              <div className="r-eyebrow" style={{ marginBottom: '4px' }}>Doing it yourself</div>
              <ul className="lp-list">
                {BEFORE.map((b) => (
                  <li key={b}>
                    <span className="ms lp-x" aria-hidden="true">close</span>{b}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lp-ba-col lp-ba-after">
              <div className="r-eyebrow lp-ok" style={{ marginBottom: '4px' }}>With Millo</div>
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

        <hr className="hr-groove" aria-hidden="true" />

        {/* ── Autonomy ─────────────────────────────────────────────────── */}
        <section className="lp-section" id="autonomy">
          <h2 className="lp-h2">Autonomy with the handbrake in view</h2>
          <p className="lp-sub">
            An assistant that acts on its own is only useful if stopping it is easier
            than trusting it. Every one of these controls is one click deep.
          </p>
          <div className="lp-grid">
            {GUARDRAILS.map((g) => (
              <article className="lp-card" key={g.title}>
                <div className="lp-card-icon">
                  <span className="ms" aria-hidden="true">{g.icon}</span>
                </div>
                <h3 className="lp-card-title">{g.title}</h3>
                <p className="lp-card-body">{g.body}</p>
              </article>
            ))}
          </div>
        </section>

        <hr className="hr-groove" aria-hidden="true" />

        {/* ── Security, honestly ───────────────────────────────────────── */}
        <section className="lp-section" id="security">
          <div className="lp-security">
            <div className="lp-security-copy">
              <h2 className="lp-h2">What is actually true about your data</h2>
              <p className="lp-sub lp-sub-tight">
                No enclave, no SOC 2 badge, no certification. Here is the real
                architecture, including the part that is not finished.
              </p>
              <dl className="lp-facts">
                <div>
                  <dt>Where it runs</dt>
                  <dd>On your phone. The Android app is a self-contained harness — no server, no account, no cloud dependency.</dd>
                </div>
                <div>
                  <dt>Your credentials</dt>
                  <dd>Email app-password and AI key live in the phone's encrypted secure store (Android Keystore-backed). They never leave the device.</dd>
                </div>
                <div>
                  <dt>Your email</dt>
                  <dd>Connects directly via IMAP/SMTP with an app password. Works with Gmail, Outlook, Yahoo, iCloud, or any self-hosted server.</dd>
                </div>
                <div>
                  <dt>Your model key</dt>
                  <dd>Bring your own key from any OpenAI-compatible provider — OpenRouter, OpenAI, Anthropic, Gemini, DeepSeek, or a custom endpoint. Nothing is proxied through us.</dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* ── Closing CTA (construction stripe) ────────────────────────── */}
        <section className="lp-section lp-close">
          <h2 className="lp-h2">Stop reading it. Start orchestrating it.</h2>
          <p className="lp-sub">Built for people who already have too much mail.</p>
          <a
            href="https://github.com/marvel-254/threadmymail/releases/latest/download/app-release.apk"
            className="btn btn-primary lp-cta-lg"
            download
          >
            Download for Android
            <span className="ms" aria-hidden="true">download</span>
          </a>
        </section>
      </main>

      <footer className="lp-foot">
        <div className="row">
          <MilloMark size={18} />
          <span style={{ fontWeight: 700 }}>ThreadMyMail</span>
          <div className="spacer" />
          <a href="https://github.com/marvel-254/threadmymail/releases/latest/download/app-release.apk" download>Download</a>
          <Link to="/system">System</Link>
          <Link to="/docs">Docs</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <span className="lp-build">Retro · 1997</span>
        </div>
      </footer>
    </div>
  );
}

/**
 * A still of the real product, rendered as a Win95 application window.
 */
function ProductSurface() {
  return (
    <div className="lp-surface" aria-hidden="true">
      <div className="lp-surface-bar">
        <span className="lp-dot" title="Minimize">_</span>
        <span className="lp-dot" title="Maximize">□</span>
        <span className="lp-dot" title="Close">✕</span>
        <span className="lp-surface-title">ThreadMyMail v1.0</span>
      </div>
      <div className="lp-surface-body">
        <div className="lp-surface-rail">
          {['stream', 'today', 'bolt', 'psychology', 'extension'].map((i, n) => (
            <span className={`lp-surface-rail-item${n === 0 ? ' is-active' : ''}`} key={i}>
              <span className="ms">{i}</span>
            </span>
          ))}
        </div>
        <div className="lp-surface-feed">
          {[0, 1, 2, 3].map((n) => (
            <div className="lp-surface-row" key={n} data-unread={n < 2 ? 'true' : 'false'} />
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
