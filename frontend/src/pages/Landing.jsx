import { useState, useEffect } from 'react';

/* Inline SVG icons — consistent 24x24 viewBox, no emojis */
const SparkleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-.91L12 2z" /></svg>
);

const MailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" ry="2" /><polyline points="2 7 12 13 22 7" /></svg>
);

const ShieldCheckIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
);

const PhoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>
);

const MoonIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 1 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
);

const SunIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
);

export default function App() {
  const [dark, setDark] = useState(() => {
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches; } catch { return false; }
  });
  const [installPrompt, setInstallPrompt] = useState(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const handleInstall = () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.then((choice) => {
      if (choice.outcome === 'accepted') console.log('PWA installed');
      setInstallPrompt(null);
    });
  };

  return (
    <>
      {/* Background ambient orbs */}
      <div className="orb" style={{ width: 420, height: 420, background: '#60A5FA', top: '-120px', left: '-80px', opacity: 0.35 }} />
      <div className="orb" style={{ width: 360, height: 360, background: '#A78BFA', bottom: '-100px', right: '-60px', opacity: 0.35 }} />

      <nav className="navbar glass" aria-label="Primary">
        <div className="nav-inner container">
          <a href="#" className="logo" aria-label="ThreadMyMail home" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.55rem', fontSize: '1.15rem' }}><img src="/logo.svg" alt="" style={{ width: '32px', height: '32px', flexShrink: 0 }} /><span><span style={{ color: 'var(--primary)' }}>Thread</span>MyMail</span></a>
          <div className="nav-links">
            <a href="#features">Features</a>
            {/* Install is secondary now. The app is published, so the page's
                job is to get people INTO it, not to make them install it. */}
            <a href="#install" aria-label="Install app">Install</a>
            <a href="/app" className="btn btn-primary" style={{ padding: '0.45rem 1rem' }} aria-label="Open the app">
              Open app
            </a>
            <button
              onClick={() => setDark(!dark)}
              className="btn btn-ghost"
              style={{ padding: '0.45rem 0.75rem', gap: '0.35rem' }}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={dark ? 'Light mode' : 'Dark mode'}
            >
              {dark ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </div>
      </nav>

      <main>
        <section className="hero" aria-label="Hero">
          <div className="container hero-grid">
            <div>
              <div className="hero-badge reveal" aria-label="Status badge">
                <SparkleIcon /> Heartbeat live — acts unattended
              </div>
              <h1 className="hero-headline reveal reveal-delay-1">
                Your assistant <span style={{ color: 'var(--primary)' }}>acts</span> — not just answers.
              </h1>
              <p className="hero-sub reveal reveal-delay-2">
                ThreadMyMail is an autonomous assistant — not a mailbox with features. It reads mail, manages calendar, tracks todos, and reports back. And it keeps working when you are not looking.
              </p>
              <div className="hero-cta reveal reveal-delay-3">
                <a href="/app" className="btn btn-primary" aria-label="Open the app">
                  <MailIcon /> Open ThreadMyMail
                </a>
                <a href="#features" className="btn btn-ghost" aria-label="Learn more about features">
                  See how it works
                </a>
              </div>
            </div>
            <div className="glass-strong reveal reveal-delay-2" style={{ position: 'relative', padding: '2.5rem', textAlign: 'center', overflow: 'hidden' }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.75rem' }}>
                Agent capabilities
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', marginBottom: '1.25rem' }}>
                Mail, calendar, todos, notes, web — all surfaces the agent can present into the stream.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                <span className="glass" style={{ padding: '0.35rem 0.9rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Mail</span>
                <span className="glass" style={{ padding: '0.35rem 0.9rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Calendar</span>
                <span className="glass" style={{ padding: '0.35rem 0.9rem', borderRadius: '9999px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)' }}>Todos</span>
              </div>
              <div style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--primary)', fontWeight: 600 }}>
                ✓ Autonomous agent &nbsp;·&nbsp; ✓ Cloudflare Workers &nbsp;·&nbsp; ✓ Heartbeat
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="features" aria-label="Features">
          <div className="container">
            <div className="section-header">
              <h2>Capabilities, not pages</h2>
              <p>Features are what the agent can do — not destinations you navigate to.</p>
            </div>
            <div className="cards">
              <article className="card glass reveal reveal-delay-1" aria-label="Mail agent feature">
                <div className="card-icon" aria-hidden="true"><MailIcon /></div>
                <h3>Mail</h3>
                <p>The agent reads, summarizes, and drafts replies. It knows your voice. No prompts — just connection.</p>
              </article>
              <article className="card glass reveal reveal-delay-2" aria-label="Calendar feature">
                <div className="card-icon" aria-hidden="true"><ShieldCheckIcon /></div>
                <h3>Calendar</h3>
                <p>Schedules, conflicts, and reminders managed by the same agent that reads your mail.</p>
              </article>
              <article className="card glass reveal reveal-delay-3" aria-label="Agent autonomy feature">
                <div className="card-icon" aria-hidden="true"><SparkleIcon /></div>
                <h3>Autonomous</h3>
                <p>Acts while you sleep. Cron heartbeats, Workflows, Durable Objects — zero idle cost.</p>
              </article>
            </div>
          </div>
        </section>

        <section id="install" className="hero" style={{ padding: '4rem 0 6rem' }} aria-label="Install">
          <div className="container" style={{ maxWidth: 640, textAlign: 'center' }}>
            <h2 style={{ marginBottom: '0.75rem' }}>Install ThreadMyMail</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem' }}>Get the app experience without an app store. Works offline, installs in seconds.</p>
            {installPrompt && (
              <button onClick={handleInstall} className="btn btn-primary" style={{ padding: '1rem 2.5rem', fontSize: '1.05rem' }} aria-label="Install Web App">
                <MailIcon /> Install App
              </button>
            )}
            {!installPrompt && (
              <p style={{ color: 'var(--text-subtle)', fontSize: '0.9rem' }}>
                If the install prompt appears, click "Install". Otherwise, add this site to your home screen manually.
              </p>
            )}
            <div style={{ marginTop: '2.5rem', display: 'flex', justifyContent: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <span className="glass" style={{ padding: '0.6rem 1rem', borderRadius: '9999px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                Mobile ready
              </span>
              <span className="glass" style={{ padding: '0.6rem 1rem', borderRadius: '9999px', fontSize: '0.85rem', fontWeight: 500, color: 'var(--text-muted)' }}>
                Offline cached
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer" aria-label="Footer">
        <div className="container footer-inner">
          <p>ThreadMyMail — an autonomous assistant. Mail, calendar, todos, web. One agent, one voice.</p>
          <p style={{ color: 'var(--text-subtle)' }}>Cloudflare Workers · Durable Objects · Heartbeat · React</p>
        </div>
      </footer>
    </>
  );
}
