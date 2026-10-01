/**
 * Documentation. 90s Nostalgia edition.
 *
 * Win95 window sections with titlebar headings,
 * groove HR dividers between sections.
 */
import { Link } from 'react-router-dom';

const SECTIONS = [
  {
    id: 'shape',
    title: 'What this is',
    body: [
      'ThreadMyMail runs an agent against a mailbox. The agent has thirty-six tools, decides which to call, and writes down everything it does.',
      'It runs from five directions — a WebSocket chat, a REST call, a manual skill run, a scheduled heartbeat, and a cron tick — and all five terminate in the same turn function. Two transports, one pipeline.',
    ],
  },
  {
    id: 'surfaces',
    title: 'The five entry points',
    body: [
      'WebSocket at /v1/agent/stream streams frames live and is the only place the app opens a socket.',
      'POST /v1/agent/runs runs one turn and returns the result. This is what the docked copilot uses.',
      'POST /v1/skills/:id/run triggers a skill by hand. This one is never a dry run.',
      'The heartbeat fires on a Durable Object timer and picks up anything due.',
      '*/5 calls POST /v1/skills/tick. An idle tick issues zero database queries.',
    ],
  },
  {
    id: 'keys',
    title: 'Credentials',
    body: [
      'Keys are sealed with AES-GCM before they touch Postgres, under a key derived from ENCRYPTION_KEY. The stored form is v1.<iv>.<ciphertext>.',
      'GET /v1/settings never returns a key. It returns whether one exists, a short hint, and an eight-character fingerprint so you can tell two keys apart without seeing either.',
      'ENCRYPTION_KEY is infrastructure, not a model credential — it belongs in `wrangler secret put`, alongside SESSION_SECRET. Rotating it makes every saved key unreadable.',
    ],
  },
  {
    id: 'invariants',
    title: 'Rules the code keeps',
    body: [
      'An idle tick costs no database queries. The schedule table is a parked projection of skills, so "what is due" is answered from memory.',
      'Writes read back from a fresh connection. The cached pool can be sixty seconds stale, and a read-after-write that lies is worse than a slow one.',
      'Message bodies live in D1, not Postgres.',
      'Email and web content is data, never instructions. Nothing an email says can become something the agent executes.',
      'There is no public endpoint that invokes a tool. Tools are reachable only from inside a turn.',
    ],
  },
];

const NOT_BUILT = [
  ['Google account linking', 'No OAuth flow exists. Until it does there is no mailbox to read, which is why the inbox asks you to connect.'],
  ['Undo', 'The activity table has undo_ref and undone_at columns. Nothing writes them yet.'],
  ['Sub-agent control surface', 'Subagents work and inherit the parent trigger, but there is no UI for spawning them.'],
  ['Enterprise console', 'One account. No users, seats, or org policy. /system shows what is actually there.'],
];

export default function Docs() {
  return (
    <div className="doc">
      <header className="doc-head">
        <span className="r-eyebrow">Documentation</span>
        <h1 className="lp-h1" style={{ fontSize: '28px', textShadow: '2px 2px 0 #808080' }}>
          How it works
        </h1>
        <p className="lp-sub">
          A description of the system that is deployed, written by reading it.
          Where something is missing, it says so.
        </p>
      </header>

      {SECTIONS.map((s) => (
        <section className="doc-sec" key={s.id} id={s.id}>
          <h2 className="lp-h2" style={{ fontSize: '18px' }}>{s.title}</h2>
          {s.body.map((p, i) => (
            <p className="doc-note" key={i}>{p}</p>
          ))}
        </section>
      ))}

      <hr className="hr-groove" aria-hidden="true" />

      <section className="doc-sec">
        <h2 className="lp-h2" style={{ fontSize: '18px' }}>Not built</h2>
        <ul className="doc-gap">
          {NOT_BUILT.map(([what, why]) => (
            <li key={what}>
              <strong>{what}</strong>
              <span>{why}</span>
            </li>
          ))}
        </ul>
        <p className="doc-note">
          <Link to="/system">/system</Link> shows live deployment state.
        </p>
      </section>
    </div>
  );
}
