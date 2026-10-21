/**
 * Daily triage scheduler.
 *
 * Mobile OSes do not let a foreground JS timer survive the app being killed, so
 * this is intentionally an in-app scheduler: once per local day, after the
 * configured time, while Millo is open. The guardrail gate inside `runTriage`
 * is still the authority — kill switch, quiet hours, budget, and shadow mode all
 * apply even when the timer fires.
 *
 * A skipped scheduled run still writes a run row, so the scheduler does not
 * retry every minute for the rest of the day.
 */
import { getGuardrails, loadGuardrails } from '../guardrails';
import { hasScheduledRunToday } from './triageStore';
import { runTriage } from './triage';

const CHECK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

async function maybeRun(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const guardrails = getGuardrails();
    if (!guardrails.loaded || !guardrails.dailyTriageEnabled) return;

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < guardrails.dailyTriageTime) return;
    if (await hasScheduledRunToday(now)) return;

    await runTriage({ trigger: 'scheduled' });
  } catch {
    // Never let a scheduler failure crash the app; the next tick retries.
  } finally {
    checking = false;
  }
}

/** Start the in-app daily scheduler. Safe to call more than once. */
export async function startTriageScheduler(): Promise<void> {
  await loadGuardrails();
  if (timer) return;
  void maybeRun();
  timer = setInterval(() => {
    void maybeRun();
  }, CHECK_INTERVAL_MS);
}

export function stopTriageScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
