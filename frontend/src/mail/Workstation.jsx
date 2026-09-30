/**
 * Workstation — the right pane. This is the app.
 *
 * Whatever is selected in the feed, its working surface is here: the mail, the
 * run, the skill, the day.
 *
 * The agent is docked here rather than given its own route. It has to be
 * present while you are reading a thread, because the most common question in
 * a mail client with a copilot is "what do you make of this?" — and answering
 * it should not require leaving the mail you were looking at. The old
 * AppShell made the stream a separate full-screen view, which is precisely the
 * drawer-by-another-name the redesign was fixing.
 */
import { useMemo } from 'react';
import Reader from './Reader.jsx';
import AgentStage from './AgentStage.jsx';
import DetailStage from './DetailStage.jsx';

export default function Workstation({ view, selectedId, openThread, onBack, showBack }) {
  const stage = useMemo(() => {
    // The stream and the inbox both carry the agent; the rest are plain detail.
    if (view === 'stream') return <AgentStage selectedId={selectedId} onBack={onBack} showBack={showBack} />;
    if (view === 'inbox') {
      return <Reader id={selectedId} onOpenThread={openThread} onBack={onBack} showBack={showBack} />;
    }
    return <DetailStage view={view} id={selectedId} onBack={onBack} showBack={showBack} />;
  }, [view, selectedId, openThread, onBack, showBack]);

  return <section className="work t-plane">{stage}</section>;
}
