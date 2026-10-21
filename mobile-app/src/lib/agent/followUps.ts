/**
 * Follow-ups — cold-thread detection and the once-a-day reminder run.
 *
 * Detection is entirely local: cached headers are grouped into conversations,
 * and a thread is cold when the newest cached message is an inbound message
 * still flagged as needing a reply, or when the user's last sent draft is older
 * than the threshold and nothing newer arrived. Automated senders are skipped.
 *
 * `runFollowUps` only raises a local notification and writes an Activity row.
 * It never sends, moves, or deletes anything. Nudge drafts are generated
 * separately by the user from the Today list and always land in the queue for
 * approval.
 */
import {
  buildThreads,
  type Message,
  type Thread,
} from '../mail';
import { loadMessages } from '../mailStore';
import { loadLastSentDraftTimes } from './draftStore';
import {
  hasFollowUpReminderToday,
  loadFollowUpSnoozes,
  markFollowUpReminder,
} from './followUpStore';
import { logActivity } from './activityStore';
import { isBulkMessage, notifyFollowUps } from '../notifications';
import {
  checkGuardrails,
  getGuardrails,
  loadGuardrails,
} from '../guardrails';
import { loadSkills } from '../skillsStore';

export type FollowUpWaiting = 'reply' | 'them';

export type FollowUp = {
  thread: Thread;
  /** Epoch ms of the event that started the cold period. */
  staleSince: number;
  waitingOn: FollowUpWaiting;
  /** Whole days cold, at least `thresholdDays`. */
  daysCold: number;
};

export type DetectOptions = {
  now?: Date;
  thresholdDays: number;
  snoozes?: Map<string, number>;
  lastSentAt?: Map<string, number>;
};

export type FollowUpRunResult = {
  count: number;
  notified: boolean;
  error?: string;
};

/** Pure cold-thread detection over cached messages. */
export function detectColdThreads(
  messages: Message[],
  options: DetectOptions,
): FollowUp[] {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const thresholdMs = Math.max(1, options.thresholdDays) * 86_400_000;
  const snoozes = options.snoozes ?? new Map<string, number>();
  const lastSentAt = options.lastSentAt ?? new Map<string, number>();

  return buildThreads(messages)
    .map<FollowUp | null>((thread) => {
      const latest = thread.latest;
      if (!latest.fromAddress) return null;
      if (isBulkMessage(latest)) return null;

      const snoozedUntil = snoozes.get(thread.id) ?? 0;
      if (snoozedUntil > nowMs) return null;

      const latestMs = Date.parse(latest.date);
      if (!Number.isFinite(latestMs)) return null;

      const sentMs = lastSentAt.get(thread.id) ?? 0;
      let staleSince: number;
      let waitingOn: FollowUpWaiting;

      if (sentMs > latestMs) {
        // The newest thing we know about is the user's own sent draft.
        staleSince = sentMs;
        waitingOn = 'them';
      } else if (latest.needsReply) {
        staleSince = latestMs;
        waitingOn = 'reply';
      } else {
        return null;
      }

      if (nowMs - staleSince < thresholdMs) return null;
      return {
        thread,
        staleSince,
        waitingOn,
        daysCold: Math.max(1, Math.floor((nowMs - staleSince) / 86_400_000)),
      };
    })
    .filter((item): item is FollowUp => item !== null)
    .sort((a, b) => a.staleSince - b.staleSince);
}

/** Load the current cold-thread list, or an empty list when the skill is off. */
export async function loadFollowUps(now = new Date()): Promise<FollowUp[]> {
  const skills = await loadSkills();
  if (!skills.follow_ups) return [];

  await loadGuardrails();
  const guardrails = getGuardrails();
  if (!guardrails.loaded) return [];

  const [messages, snoozes, lastSentAt] = await Promise.all([
    loadMessages(),
    loadFollowUpSnoozes(),
    loadLastSentDraftTimes(),
  ]);

  return detectColdThreads(messages, {
    now,
    thresholdDays: guardrails.followUpDays,
    snoozes,
    lastSentAt,
  });
}

/**
 * Detect cold threads and raise at most one local reminder. Called by the
 * scheduler after the configured time, or manually from Settings. Always
 * records an Activity row when it ran, including why an alert was withheld.
 */
export async function runFollowUps(
  trigger: 'scheduled' | 'manual' = 'scheduled',
): Promise<FollowUpRunResult> {
  try {
    const skills = await loadSkills();
    if (!skills.follow_ups) {
      return { count: 0, notified: false, error: 'Follow-ups are turned off.' };
    }

    const items = await loadFollowUps();
    if (items.length === 0) {
      await markFollowUpReminder(0);
      return { count: 0, notified: false };
    }

    const gate = checkGuardrails('notification');
    await markFollowUpReminder(items.length);
    if (!gate.allowed) {
      await logActivity({
        type: 'follow_up_skipped',
        outcome: 'skipped',
        detail: `Found ${items.length} cold thread${items.length === 1 ? '' : 's'}, but no reminder was sent: ${
          gate.reason ?? 'notifications are blocked'
        }`,
        targetType: 'thread',
        targetId: items[0].thread.id,
        subject: items[0].thread.subject,
      });
      return { count: items.length, notified: false };
    }

    const notified = await notifyFollowUps(items.length);
    const subjects = items
      .slice(0, 3)
      .map((item) => `"${item.thread.subject}"`)
      .join(', ');
    await logActivity({
      type: 'follow_up_reminder',
      outcome: notified ? 'ok' : 'skipped',
      detail: notified
        ? `${trigger === 'manual' ? 'Checked manually' : 'Daily check'} — reminded you about ${items.length} cold thread${
            items.length === 1 ? '' : 's'
          } (${subjects}${items.length > 3 ? ', …' : ''}).`
        : `Found ${items.length} cold thread${items.length === 1 ? '' : 's'} (${subjects}${
            items.length > 3 ? ', …' : ''
          }), but new-mail notifications are off.`,
      targetType: 'thread',
      targetId: items[0].thread.id,
      subject: items[0].thread.subject,
    });
    return { count: items.length, notified };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity({
      type: 'follow_up_error',
      outcome: 'error',
      detail: `Follow-up check failed: ${message}`,
    });
    return { count: 0, notified: false, error: message };
  }
}

/** True when today's scheduled reminder already ran. */
export { hasFollowUpReminderToday };
