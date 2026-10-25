/**
 * Changelog — what is new. 90s Nostalgia edition.
 */
import DocNav from '../components/DocNav.jsx';

const RELEASES = [
  {
    version: 'v3.0.0',
    date: 'October 20, 2026',
    type: 'major',
    changes: [
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Android-native chat redesign — full-screen agent conversations on a native top app bar',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Conversation history stored on-device in SQLite — recent chats survive restarts',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Home-screen drawer — recent conversations, inbox, activity, and settings',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Wallpapers — pick a preset or your own photo, globally or per conversation',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Email threads referenced in chat — tap a chip to open the thread in the mailbox',
      },
      {
        label: 'FIX',
        icon: 'build',
        text: 'Stop generation, long-press copy, and composer inset handling',
      },
    ],
  },
  {
    version: 'v1.0.0',
    date: 'October 2026',
    type: 'major',
    changes: [
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'ThreadMyMail launches — autonomous email intelligence on Android',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Millo agent with 36 tools for triage, drafting, and follow-ups',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'IMAP/SMTP with app-password — works with Gmail, Outlook, Yahoo, iCloud, and any self-hosted server',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Bring your own model key — OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, or any OpenAI-compatible endpoint',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'On-device credential storage — keys never leave your phone',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Activity log for every agent action — reversible actions stay marked as such',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Kill switch always visible in the top bar — one press and Millo stops acting on its own',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Dry-run shadowing — Millo takes every step and writes it to the log, but sends nothing',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'Daily run budgets and quiet hours per skill',
      },
      {
        label: 'NEW',
        icon: 'add_circle',
        text: 'No account, no server, no cloud dependency — it all runs on your phone',
      },
    ],
  },
];

export default function Changelog() {
  return (
    <div className="doc">
      <DocNav
        title="Changelog"
        links={[
          { to: '/', label: 'Home' },
          { to: '/terms', label: 'Terms' },
          { to: '/privacy', label: 'Privacy' },
        ]}
      />
      <header className="doc-head">
        <span className="r-eyebrow">What changed</span>
        <h1
          className="lp-h1"
          style={{ fontSize: '28px', textShadow: '2px 2px 0 #808080' }}
        >
          Changelog
        </h1>
        <p className="lp-sub">
          Every release, every fix, every reason the version number went up.
        </p>
      </header>

      <div className="doc-alert">
        <span className="ms" aria-hidden="true">info</span>
        <p>
          This page records what shipped. To download the latest version, go to
          the{' '}
          <a href="https://github.com/marvel-254/threadmymail/releases/latest/download/app-release.apk" download>
            releases page
          </a>{' '}
          on GitHub.
        </p>
      </div>

      {RELEASES.map((release) => (
        <section className="doc-sec" key={release.version}>
          <div className="changelog-header">
            <span className="changelog-version">{release.version}</span>
            <span className="changelog-date">{release.date}</span>
          </div>

          <ul className="changelog-list">
            {release.changes.map((c) => (
              <li key={c.text} className="changelog-item">
                <span className="changelog-label" data-type={release.type}>
                  {c.label}
                </span>
                <span className="ms changelog-icon" aria-hidden="true">
                  {c.icon}
                </span>
                <span className="changelog-text">{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <hr className="hr-groove" aria-hidden="true" />

      <section className="doc-sec">
        <h2 className="lp-h2" style={{ fontSize: '18px' }}>
          Something broken?
        </h2>
        <p className="doc-note">
          If something is not working as described, open an issue on{' '}
          <a
            href="https://github.com/marvel-254/threadmymail/issues"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          .
        </p>
      </section>
    </div>
  );
}
