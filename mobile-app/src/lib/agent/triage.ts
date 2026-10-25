/**
 * Triage — Millo's first real skill.
 *
 * Input is the unread backlog already cached in SQLite; nothing is fetched from
 * IMAP and no message body leaves the device. The primary provider classifies
 * headers in small batches, the engine applies only *local* flags (read, star,
 * needs-reply), and every decision is written to the activity log with the run
 * id that produced it.
 *
 * Nothing here sends, archives, or deletes mail. Those are outward-facing and
 * belong behind the draft queue + explicit approval.
 *
 * Gate order is deliberate: skill → kill switch/budget/quiet hours → candidates
 * → per-call AI budget. A skipped run still leaves a `triage_runs` row so the
 * daily scheduler cannot retry in a loop.
 */
import { useEffect, useState } from 'react';
import { loadAccounts } from '../accountStore';
import { streamChat } from '../aiClient';
import { consumeAiCall, consumeTriageRun, isQuietHours, loadGuardrails } from '../guardrails';
import { loadMessages, markRead, setNeedsReply, setStarred } from '../mailStore';
import { getEnabledSkillIds } from '../skillsStore';
import type { Message } from '../mail';
import { logActivity } from './activityStore';
import {
  createTriageRun,
  finishTriageRun,
  loadClassifiedMessageIds,
  saveTriageResults,
  type TriageRunStatus,
  type TriageVerdict,
} from './triageStore';

export const MAX_MESSAGES_PER_RUN = 40;
export const CLASSIFY_BATCH_SIZE = 10;

const VERDICTS: TriageVerdict[] = ['ignore', 'read-later', 'needs-reply', 'action-required'];

const TRIAGE_SYSTEM = [
  'You are an email triage classifier running entirely on the user\'s phone.',
  'You receive only headers and short previews, never full message bodies.',
  'Classify each email into exactly one verdict:',
  '- "ignore": automated, promotional, notification, or otherwise needs no human attention.',
  '- "read-later": worth reading but no reply or action is required.',
  '- "needs-reply": a person is waiting for an answer from the user.',
  '- "action-required": the user must do something (deadline, payment, confirmation, attachment).',
  'Be conservative: never invent commitments, dates, or senders. If unsure between read-later and needs-reply, choose read-later.',
  'Return ONLY a JSON object shaped like {"verdicts":[{"n":0,"verdict":"needs-reply","reason":"..."}]}.',
  'Use the exact "n" index supplied. Keep each reason under 15 words. Do not include markdown or prose.',
].join('\n');

export type TriageRunResult = {
  runId: string | null;
  status: TriageRunStatus;
  summary: string;
  classified: number;
  total: number;
  reason: string | null;
};

type TriageUIState = {
  running: boolean;
  runId: string | null;
  lastSummary: string | null;
  lastStatus: TriageRunStatus | null;
  lastRunAt: number | null;
};

let uiState: TriageUIState = {
  running: false,
  runId: null,
  lastSummary: null,
  lastStatus: null,
  lastRunAt: null,
};

const listeners = new Set<(next: TriageUIState) => void>();
let activeRun: { runId: string; controller: AbortController } | null = null;

function emit() {
  uiState = { ...uiState };
  listeners.forEach((listener) => listener(uiState));
}

function setUI(patch: Partial<TriageUIState>) {
  uiState = { ...uiState, ...patch };
  emit();
}

export function getTriageState(): TriageUIState {
  return uiState;
}

export function subscribeTriage(listener: (next: TriageUIState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTriage(): TriageUIState {
  const [snapshot, setSnapshot] = useState<TriageUIState>(getTriageState);
  useEffect(() => {
    setSnapshot(getTriageState());
    return subscribeTriage(setSnapshot);
  }, []);
  return snapshot;
}

function newRunId(): string {
  return `triage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Reject a run immediately; still leaves an auditable skipped run row. */
async function skipRun(
  trigger: 'manual' | 'scheduled',
  reason: string,
): Promise<TriageRunResult> {
  const runId = newRunId();
  await createTriageRun({ id: runId, trigger, total: 0, shadow: false });
  await finishTriageRun({ id: runId, status: 'skipped', classified: 0, error: reason });
  await logActivity({
    runId,
    type: 'triage_run',
    outcome: 'skipped',
    detail: `Triage skipped: ${reason}`,
  });
  setUI({ lastSummary: reason, lastStatus: 'skipped', lastRunAt: Date.now() });
  return { runId, status: 'skipped', summary: reason, classified: 0, total: 0, reason };
}

async function candidates(): Promise<Message[]> {
  const [messages, accounts, classified] = await Promise.all([
    loadMessages(),
    loadAccounts(),
    loadClassifiedMessageIds(),
  ]);
  const ownAddresses = new Set(accounts.map((account) => account.email.toLowerCase()));
  return messages
    .filter((m) => (
      m.unread
      && !ownAddresses.has(m.fromAddress.toLowerCase())
      && !classified.has(m.id)
    ))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_MESSAGES_PER_RUN);
}

function buildPrompt(batch: Message[]): string {
  const lines = batch.map((m, index) => {
    const date = m.date.slice(0, 10);
    return [
      `[${index}]`,
      `From: ${clip(m.from, 80)} <${clip(m.fromAddress, 80)}>`,
      `Subject: ${clip(m.subject, 160)}`,
      `Date: ${date}`,
      `Preview: ${clip(m.preview, 260)}`,
    ].join('\n');
  });
  return [
    `Classify these ${batch.length} unread emails. Use the given index as "n".`,
    '',
    lines.join('\n\n'),
  ].join('\n');
}

type ParsedVerdict = { messageId: string; verdict: TriageVerdict; reason: string };

/** Tolerate code fences and stray prose around the JSON object. */
function parseVerdicts(text: string, batch: Message[]): ParsedVerdict[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }

  const raw = (payload as { verdicts?: unknown }).verdicts;
  if (!Array.isArray(raw)) return null;

  const seen = new Set<string>();
  const results: ParsedVerdict[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { n?: unknown; verdict?: unknown; reason?: unknown };
    const index = Number(record.n);
    if (!Number.isInteger(index) || index < 0 || index >= batch.length) continue;
    const verdict = VERDICTS.includes(record.verdict as TriageVerdict)
      ? (record.verdict as TriageVerdict)
      : null;
    if (!verdict) continue;
    const message = batch[index];
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    results.push({
      messageId: message.id,
      verdict,
      reason: clip(typeof record.reason === 'string' ? record.reason : '', 160)
        || 'No reason given.',
    });
  }
  return results;
}

type BatchOutcome =
  | { ok: true; results: ParsedVerdict[]; aborted: boolean }
  | { ok: false; error: string; aborted: boolean };

async function classifyBatch(batch: Message[], signal: AbortSignal): Promise<BatchOutcome> {
  const gate = await consumeAiCall();
  if (!gate.allowed) {
    return { ok: false, error: gate.reason ?? 'AI-call budget is exhausted.', aborted: false };
  }

  const response = await streamChat({
    system: TRIAGE_SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(batch) }],
    maxTokens: 1200,
    signal,
  });

  if (!response.ok) {
    return { ok: false, error: response.error, aborted: response.aborted };
  }
  if (response.aborted) {
    return { ok: false, error: 'Triage was cancelled.', aborted: true };
  }

  const parsed = parseVerdicts(response.text, batch);
  if (!parsed) {
    return { ok: false, error: 'The classifier returned unreadable output.', aborted: false };
  }

  // Cover any message the model skipped so the backlog does not get stuck.
  const answered = new Set(parsed.map((p) => p.messageId));
  for (const message of batch) {
    if (!answered.has(message.id)) {
      parsed.push({
        messageId: message.id,
        verdict: 'read-later',
        reason: 'Millo could not classify this message.',
      });
    }
  }

  return { ok: true, results: parsed, aborted: false };
}

function actionLabel(verdict: TriageVerdict): string {
  switch (verdict) {
    case 'ignore':
      return 'marked read (low priority)';
    case 'read-later':
      return 'kept unread for later';
    case 'needs-reply':
      return 'flagged for reply';
    case 'action-required':
      return 'starred — action required';
  }
}

/** Apply the local-only flags. Outward actions are never taken here. */
async function applyVerdicts(
  results: ParsedVerdict[],
  shadow: boolean,
  batch: Message[],
): Promise<void> {
  const messages = new Map(batch.map((message) => [message.id, message]));
  for (const result of results) {
    const before = messages.get(result.messageId);
    if (!shadow) {
      if (result.verdict === 'ignore') {
        await markRead(result.messageId);
        await setNeedsReply(result.messageId, false);
      } else if (result.verdict === 'read-later') {
        await setNeedsReply(result.messageId, false);
      } else if (result.verdict === 'needs-reply') {
        await setNeedsReply(result.messageId, true);
      } else {
        await setStarred(result.messageId, true);
        await setNeedsReply(result.messageId, true);
      }
    }
    await logActivity({
      runId: activeRun?.runId ?? null,
      type: 'triage_decision',
      outcome: shadow ? 'skipped' : 'ok',
      detail: `${shadow ? 'Would have ' : ''}${actionLabel(result.verdict)}: ${result.reason}`,
      targetType: 'message',
      targetId: result.messageId,
      subject: before?.subject ?? null,
      ...(shadow || !before
        ? {}
        : {
            undoPayload: {
              kind: 'mail_flags' as const,
              messageId: result.messageId,
              unread: before.unread,
              starred: before.starred,
              needsReply: before.needsReply,
            },
          }),
    });
  }
}

function summarize(input: {
  total: number;
  classified: number;
  counts: Record<TriageVerdict, number>;
  status: TriageRunStatus;
  shadow: boolean;
  error: string | null;
}): string {
  if (input.status === 'cancelled') {
    return `Triage cancelled after ${input.classified} of ${input.total}.`;
  }
  if (input.status === 'error') {
    return `Triage stopped: ${input.error ?? 'unknown error'}`;
  }
  if (input.total === 0) return 'No new mail to triage.';

  const details: string[] = [];
  if (input.counts['action-required']) details.push(`${input.counts['action-required']} need action`);
  if (input.counts['needs-reply']) details.push(`${input.counts['needs-reply']} need a reply`);
  if (input.counts['read-later']) details.push(`${input.counts['read-later']} read later`);
  if (input.counts.ignore) details.push(`${input.counts.ignore} ignored`);

  const prefix = input.shadow ? 'Shadow triage: ' : 'Triaged ';
  const base = input.shadow
    ? `${input.classified} of ${input.total} messages`
    : `${input.classified} messages`;
  const tail = details.length ? ` — ${details.join(', ')}.` : '.';
  const stopped = input.error && input.classified < input.total
    ? ` Stopped early: ${input.error}`
    : '';
  return `${prefix}${base}${tail}${stopped}`;
}

/**
 * A home-screen widget tap is still a deliberate request, but it should not
 * wake the classifier during quiet hours the way an in-app tap can.
 */
export async function runTriageFromWidget(): Promise<TriageRunResult> {
  await loadGuardrails();
  if (isQuietHours()) {
    return skipRun('manual', 'Quiet hours are active.');
  }
  return runTriage({ trigger: 'manual' });
}

export async function runTriage(
  options: { trigger?: 'manual' | 'scheduled' } = {},
): Promise<TriageRunResult> {
  const trigger = options.trigger ?? 'manual';

  if (activeRun) {
    return {
      runId: activeRun.runId,
      status: 'running',
      summary: 'Triage is already running.',
      classified: 0,
      total: 0,
      reason: 'Triage is already running.',
    };
  }

  const skills = await getEnabledSkillIds();
  if (!skills.includes('triage')) {
    return skipRun(trigger, 'Triage is switched off in Settings.');
  }

  const gate = await consumeTriageRun(trigger);
  if (!gate.allowed && !gate.shadowed) {
    return skipRun(trigger, gate.reason ?? 'Guardrails blocked this run.');
  }
  const shadow = gate.shadowed;

  const backlog = await candidates();
  const runId = newRunId();
  await createTriageRun({ id: runId, trigger, total: backlog.length, shadow });

  if (backlog.length === 0) {
    await finishTriageRun({ id: runId, status: 'completed', classified: 0 });
    await logActivity({
      runId,
      type: 'triage_run',
      outcome: 'ok',
      detail: 'Triage found no unread messages.',
    });
    const summary = 'No new mail to triage.';
    setUI({ lastSummary: summary, lastStatus: 'completed', lastRunAt: Date.now() });
    return { runId, status: 'completed', summary, classified: 0, total: 0, reason: null };
  }

  const controller = new AbortController();
  activeRun = { runId, controller };
  setUI({ running: true, runId, lastStatus: 'running', lastRunAt: null });
  await logActivity({
    runId,
    type: 'triage_run',
    outcome: 'ok',
    detail: `Started ${trigger} triage for ${backlog.length} unread messages${shadow ? ' (shadow mode)' : ''}.`,
  });

  const counts: Record<TriageVerdict, number> = {
    ignore: 0,
    'read-later': 0,
    'needs-reply': 0,
    'action-required': 0,
  };
  let classified = 0;
  let status: TriageRunStatus = 'completed';
  let error: string | null = null;

  try {
    for (let offset = 0; offset < backlog.length; offset += CLASSIFY_BATCH_SIZE) {
      if (controller.signal.aborted) {
        status = 'cancelled';
        break;
      }
      const batch = backlog.slice(offset, offset + CLASSIFY_BATCH_SIZE);
      const outcome = await classifyBatch(batch, controller.signal);

      if (!outcome.ok) {
        if (outcome.aborted) {
          status = 'cancelled';
        } else {
          status = classified > 0 ? 'completed' : 'error';
          error = outcome.error;
        }
        break;
      }

      await saveTriageResults(runId, outcome.results);
      await applyVerdicts(outcome.results, shadow, batch);
      for (const result of outcome.results) counts[result.verdict] += 1;
      classified += outcome.results.length;
    }
  } catch (err) {
    status = 'error';
    error = describeError(err);
  } finally {
    await finishTriageRun({ id: runId, status, classified, error });
    const summary = summarize({ total: backlog.length, classified, counts, status, shadow, error });
    await logActivity({
      runId,
      type: 'triage_run',
      outcome: status === 'completed' ? 'ok' : status === 'cancelled' ? 'skipped' : 'error',
      detail: summary,
    });
    activeRun = null;
    setUI({
      running: false,
      runId: null,
      lastSummary: summary,
      lastStatus: status,
      lastRunAt: Date.now(),
    });
  }

  return {
    runId,
    status,
    summary: summarize({ total: backlog.length, classified, counts, status, shadow, error }),
    classified,
    total: backlog.length,
    reason: error,
  };
}

/** Abort the in-flight run. The batch already applied stays applied. */
export function cancelTriage(): void {
  activeRun?.controller.abort();
}
