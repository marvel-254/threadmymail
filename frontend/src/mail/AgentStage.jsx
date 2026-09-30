import { useThemeTokens } from '../lib/hooks.js';
import AgentStream from '../app/AgentStream.jsx';

/**
 * The full stream — the agent's running commentary, with tool calls inline.
 *
 * Reuses the existing AgentStream rather than reimplementing the WebSocket
 * protocol. That component already handles reconnection with backoff, tool
 * calls and artifacts correctly, and it is the only place in the app that
 * opens a socket to the Durable Object.
 */
export default function AgentStage({ onBack, showBack }) {
  const tokens = useThemeTokens(true);

  return (
    <div className="stage">
      {showBack && (
        <button className="btn-ghost stage-back" onClick={onBack} aria-label="Back">
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
      )}
      <AgentStream theme={tokens} />
    </div>
  );
}
