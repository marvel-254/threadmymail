/**
 * Trigger Bus — lightweight event backbone for the scheduler.
 *
 * Events:
 * - 'mail:new'      → fired by IDLE when new mail arrives (payload: Message[])
 * - 'app:foreground' → fired when AppState becomes active
 * - 'schedule:fire' → fired by heartbeat for due jobs (payload: job id)
 *
 * Skills subscribe via on(event, handler) — no global state, just a Set of
 * handlers per event. Keeps the app decoupled from ad-hoc timers.
 */
type Handler<T = unknown> = (payload: T) => void | Promise<void>;

const handlers = new Map<string, Set<Handler>>();

function getHandlers(event: string): Set<Handler> {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  return set;
}

/**
 * Subscribe to an event. Returns an unsubscribe function.
 */
export function on(event: string, handler: Handler): () => void {
  const set = getHandlers(event);
  set.add(handler);
  return () => {
    set.delete(handler);
    if (set.size === 0) handlers.delete(event);
  };
}

/**
 * Emit an event to all handlers. Errors are caught and logged to Activity
 * (best-effort, non-blocking).
 */
export async function emit<T = unknown>(event: string, payload: T): Promise<void> {
  const set = handlers.get(event);
  if (!set || set.size === 0) return;

  // Fire all handlers concurrently; catch individual errors so one bad
  // handler doesn't block the others or throw here.
  await Promise.allSettled(
    Array.from(set).map((handler) =>
      Promise.resolve()
        .then(() => handler(payload))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`TriggerBus ${event} handler error:`, message);
        }),
    ),
  );
}

/**
 * Predefined event names for consistency.
 */
export const TriggerEvents = {
  MAIL_NEW: 'mail:new',
  APP_FOREGROUND: 'app:foreground',
  SCHEDULE_FIRE: 'schedule:fire',
} as const;