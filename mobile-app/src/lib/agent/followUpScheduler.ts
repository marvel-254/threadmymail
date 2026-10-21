/**
 * Once-a-day follow-up reminder scheduler.
 *
 * Like the triage scheduler this is an in-app timer: mobile OSes do not keep a
 * foreground JS timer alive after the app is killed. The reminder only fires
 * while Millo is open, after the configured local time, and only once per
 * local day. Quiet hours are checked here so a blocked morning does not
 * consume the day's reminder — once quiet hours end, the next tick runs it.
 */
import { getGuardrails, isQuietHours, loadGuardrails } from '../guardrails';
import { loadSkills } from '../skillsStore';
import { hasFollowUpReminderToday, runFollowUps } from './followUps';

const CHECK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let checking = false;

async function maybeRun(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    await loadGuardrails();
    const guardrails = getGuardrails();
    if (!guardrails.loaded) return;

    const skills = await loadSkills();
    if (!skills.follow_ups) return;

    const now = new Date();
    const minutes = now.getHours() * 60 + now.getMinutes();
    if (minutes < guardrails.followUpTime) return;
    if (isQuietHours(now)) return;
    if (await hasFollowUpReminderToday(now)) return;

    await runFollowUps('scheduled');
  } catch {
    // Never let a scheduler failure crash the app; the next tick retries.
  } finally {
    checking = false;
  }
}

/** Start the in-app follow-up scheduler. Safe to call more than once. */
export async function startFollowUpScheduler(): Promise<void> {
  await loadGuardrails();
  if (timer) return;
  void maybeRun();
  timer = setInterval(() => {
    void maybeRun();
  }, CHECK_INTERVAL_MS);
}

export function stopFollowUpScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
