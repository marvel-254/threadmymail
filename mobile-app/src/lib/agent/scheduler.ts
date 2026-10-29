/**
 * Scheduler Core — heartbeat tick + cron/interval/event scheduling.
 *
 * - One ~30s tick while the app is in the foreground.
 * - On every tick and on foreground resume, fires all due jobs.
 * - Catch-up policy: missed runs within `catchUpWindowHours` run once;
 *   older misses are marked `skipped` in Activity.
 * - Every firing passes guardrails (kill switch, quiet hours, budget) and
 *   logs to Activity store.
 * - Single-flight lock per job (no overlapping runs of the same job).
 */
import { AppState, AppStateStatus } from 'react-native';
import { isQuietHours, loadGuardrails, consumeTriageRun, getGuardrails } from '../guardrails';
import { logActivity } from './activityStore';
import {
  getDueJobs,
  getJob,
  computeNextRun,
  listJobs,
  setJobNextRun,
  setJobLastRun,
  upsertJob,
  type Job,
} from './schedulerStore';
import { on, emit, TriggerEvents } from './triggerBus';

const HEARTBEAT_INTERVAL_MS = 30_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let mailNewUnsubscribe: (() => void) | null = null;
let runningJobs = new Set<string>();
let initialized = false;

/** Register the built-in AI-SKILLS.md starter jobs. */
export async function registerBuiltInJobs(): Promise<void> {
  const now = Date.now();
  const jobs: Job[] = [
    {
      id: 'triage_inbox',
      name: 'Triage Inbox',
      trigger: { type: 'cron', expression: '*/15 * * * *' }, // every 15 min
      constraints: {
        respectQuietHours: true,
        respectBudget: true,
        catchUpWindowHours: 6,
      },
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      lastOutcome: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'follow_up_chaser',
      name: 'Follow-up Chaser',
      trigger: { type: 'cron', expression: '0 9 * * *' }, // 09:00 daily
      constraints: {
        respectQuietHours: true,
        respectBudget: true,
        catchUpWindowHours: 24,
      },
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      lastOutcome: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'morning_briefing',
      name: 'Morning Briefing',
      trigger: { type: 'cron', expression: '0 7 * * *' }, // 07:00 daily
      constraints: {
        respectQuietHours: true,
        respectBudget: true,
        catchUpWindowHours: 12,
      },
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      lastOutcome: null,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'weekly_review',
      name: 'Weekly Review',
      trigger: { type: 'cron', expression: '0 10 * * 1' }, // Monday 10:00
      constraints: {
        respectQuietHours: true,
        respectBudget: true,
        catchUpWindowHours: 48,
      },
      enabled: true,
      nextRunAt: null,
      lastRunAt: null,
      lastOutcome: null,
      createdAt: now,
      updatedAt: now,
    },
  ];

  for (const job of jobs) {
    const existing = await getJob(job.id);
    if (!existing) {
      job.nextRunAt = computeNextRun(job, now);
      await upsertJob(job);
    }
  }
}

/**
 * Start the heartbeat scheduler. Safe to call multiple times.
 * Must be called after guardrails are loaded.
 */
export async function startScheduler(): Promise<void> {
  if (initialized) return;

  await loadGuardrails();
  await registerBuiltInJobs();

  // Initialize next run times for all jobs
  await refreshNextRuns();

  // Heartbeat tick
  await maybeRunDueJobs();
  heartbeatTimer = setInterval(() => {
    void maybeRunDueJobs();
  }, HEARTBEAT_INTERVAL_MS);

  // AppState foreground trigger
  appStateSubscription = AppState.addEventListener('change', async (nextState: AppStateStatus) => {
    if (nextState === 'active') {
      await emit(TriggerEvents.APP_FOREGROUND, {});
      await maybeRunDueJobs();
    }
  });

  // mail:new — new mail arriving via IDLE. A scheduled triage that is due now
  // runs immediately rather than waiting for the next heartbeat. Bounded by
  // the same daily gates inside runTriage, so it never spawns duplicate work.
  const notify = () => void maybeRunDueJobs();
  mailNewUnsubscribe = on(TriggerEvents.MAIL_NEW, notify);

  initialized = true;
}

/** Stop the heartbeat and cleanup. */
export function stopScheduler(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }
  if (mailNewUnsubscribe) {
    mailNewUnsubscribe();
    mailNewUnsubscribe = null;
  }
  initialized = false;
}

/** Recompute nextRunAt for all enabled jobs. */
export async function refreshNextRuns(): Promise<void> {
  const jobs = await listJobs();
  const now = Date.now();
  for (const job of jobs) {
    if (!job.enabled) continue;
    const next = computeNextRun(job, now);
    if (next !== null) {
      await setJobNextRun(job.id, next);
    }
  }
}

/**
 * Find and run all due jobs. Handles catch-up, guardrails, single-flight lock,
 * and activity logging.
 */
async function maybeRunDueJobs(): Promise<void> {
  const now = Date.now();
  const due = await getDueJobs(now);

  for (const job of due) {
    // Single-flight lock
    if (runningJobs.has(job.id)) continue;
    runningJobs.add(job.id);

    try {
      const outcome = await runJob(job, now);
      await setJobLastRun(job.id, now, outcome.outcome);

      // Schedule next run
      const next = computeNextRun(job, now);
      if (next !== null) {
        await setJobNextRun(job.id, next);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await setJobLastRun(job.id, now, 'error');
      await logActivity({
        type: 'scheduler_error',
        outcome: 'error',
        detail: `Job "${job.name}" failed: ${message}`,
      });
    } finally {
      runningJobs.delete(job.id);
    }
  }
}

type RunOutcome = { outcome: 'ok' | 'skipped' | 'error'; reason?: string };

async function runJob(job: Job, now: number): Promise<RunOutcome> {
  const constraints = job.constraints;

  // Guardrail gate for scheduled/interval jobs
  if (job.trigger.type === 'cron' || job.trigger.type === 'interval') {
    if (constraints.respectQuietHours && isQuietHours()) {
      await logActivity({
        type: 'scheduler_run',
        outcome: 'skipped',
        detail: `Job "${job.name}" skipped: quiet hours.`,
      });
      return { outcome: 'skipped', reason: 'quiet_hours' };
    }

    // Check budget via guardrails
    const gate = await checkScheduledGuardrails();
    if (!gate.allowed) {
      await logActivity({
        type: 'scheduler_run',
        outcome: 'skipped',
        detail: `Job "${job.name}" skipped: ${gate.reason ?? 'guardrails'}.`,
      });
      return { outcome: 'skipped', reason: gate.reason ?? 'guardrails' };
    }
  }

  // Execute the job
  try {
    await executeJob(job);
    await logActivity({
      type: 'scheduler_run',
      outcome: 'ok',
      detail: `Job "${job.name}" completed.`,
    });
    return { outcome: 'ok' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity({
      type: 'scheduler_run',
      outcome: 'error',
      detail: `Job "${job.name}" failed: ${message}`,
    });
    return { outcome: 'error', reason: message };
  }
}

async function checkScheduledGuardrails(): Promise<{ allowed: boolean; reason: string | null }> {
  // Use the same gate as scheduled triage runs (kill switch, quiet hours, budget).
  const gate = await consumeTriageRun('scheduled');
  return { allowed: gate.allowed, reason: gate.reason };
}

/**
 * Dispatch to the actual skill implementation based on job id.
 * This is the plug point — each job id maps to its engine function.
 */
async function executeJob(job: Job): Promise<void> {
  switch (job.id) {
    case 'triage_inbox': {
      // Respect the user's Settings "Daily morning triage" toggle + time so
      // this unified job does not bypass the explicit Automation preference.
      await loadGuardrails();
      const settings = getGuardrails();
      if (!settings.loaded) return;
      if (!settings.dailyTriageEnabled) return;
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      if (minutes < settings.dailyTriageTime) return;
      const { hasScheduledRunToday } = await import('./triageStore');
      if (await hasScheduledRunToday(now)) return;
      const { runTriage } = await import('./triage');
      await runTriage({ trigger: 'scheduled' });
      break;
    }
    case 'follow_up_chaser': {
      // Respect the follow-up skill toggle and the reminder time.
      await loadGuardrails();
      const settings = getGuardrails();
      if (!settings.loaded) return;
      const { loadSkills } = await import('../skillsStore');
      const skills = await loadSkills();
      if (!skills.follow_ups) return;
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      if (minutes < settings.followUpTime) return;
      const { runFollowUps, hasFollowUpReminderToday } = await import('./followUps');
      if (await hasFollowUpReminderToday(now)) return;
      await runFollowUps('scheduled');
      break;
    }
    case 'morning_briefing': {
      // TodayScreen already builds the briefing from stored data.
      // This job just ensures triage/follow-ups have run so the briefing is fresh.
      const { runTriage } = await import('./triage');
      const { runFollowUps } = await import('./followUps');
      await runTriage({ trigger: 'scheduled' });
      await runFollowUps('scheduled');
      break;
    }
    case 'weekly_review': {
      // Placeholder for future weekly digest skill.
      // Could compile a summary email or notification.
      const { logActivity } = await import('./activityStore');
      await logActivity({
        type: 'weekly_review',
        outcome: 'ok',
        detail: 'Weekly review placeholder executed.',
      });
      break;
    }
    default:
      throw new Error(`Unknown job: ${job.id}`);
  }
}

/** Enable/disable a job and recompute its schedule. */
export async function setJobEnabled(jobId: string, enabled: boolean): Promise<void> {
  const { setJobEnabled: storeSetEnabled } = await import('./schedulerStore');
  await storeSetEnabled(jobId, enabled);
  if (enabled) {
    const next = computeNextRun((await listJobs()).find((j) => j.id === jobId)!, Date.now());
    if (next !== null) {
      await setJobNextRun(jobId, next);
    }
  } else {
    await setJobNextRun(jobId, null);
  }
}

/** Manually trigger a job (for Settings "Run now"). */
export async function triggerJob(jobId: string): Promise<{ ok: boolean; error?: string }> {
  const { getJob: storeGetJob } = await import('./schedulerStore');
  const job = await storeGetJob(jobId);
  if (!job) return { ok: false, error: 'Job not found' };

  if (runningJobs.has(jobId)) {
    return { ok: false, error: 'Job already running' };
  }

  runningJobs.add(jobId);
  try {
    await executeJob(job);
    await logActivity({
      type: 'scheduler_run',
      outcome: 'ok',
      detail: `Job "${job.name}" run manually.`,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity({
      type: 'scheduler_run',
      outcome: 'error',
      detail: `Job "${job.name}" manual run failed: ${message}`,
    });
    return { ok: false, error: message };
  } finally {
    runningJobs.delete(jobId);
  }
}

/** Check if scheduler is running. */
export function isSchedulerRunning(): boolean {
  return initialized;
}