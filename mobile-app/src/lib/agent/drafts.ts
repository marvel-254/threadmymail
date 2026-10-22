/**
 * Draft replies — generation, approval, and the one-click queue actions.
 *
 * Generation is an AI call, so it passes the shared `consumeAiCall` gate. It is
 * still allowed in shadow mode: the user can see the draft, but `sendDraft`
 * refuses to send while shadow mode is on.
 *
 * Nothing is sent here without an explicit `sendDraft` call from the UI. The
 * prompt includes the last few approved replies so the output drifts toward the
 * user's own voice over time.
 */
import { checkGuardrails, consumeAiCall } from '../guardrails';
import { streamChat } from '../aiClient';
import { getMailSync } from '../mailSyncSingleton';
import { loadMessage } from '../mailStore';
import type { Message } from '../mail';
import { logActivity } from './activityStore';
import {
  addVoiceSample,
  createDraft,
  getDraft,
  setDraftStatus,
  loadVoiceSamples,
  type Draft,
} from './draftStore';

const FOLLOW_UP_SYSTEM = [
  'You write short, polite follow-up nudges for the user, in the user\'s voice.',
  'Output only the email body — no subject line, no markdown fences, no commentary.',
  'Keep it to a few sentences. Reference the thread naturally and ask whether a reply is still coming.',
  'Do not invent facts, deadlines, attachments, or commitments that are not in the thread preview.',
  'Never sound passive-aggressive or guilt-tripping.',
].join('\n');

const DRAFT_SYSTEM = [
  'You write email replies for the user, in the user\'s voice.',
  'Output only the reply body — no subject line, no markdown fences, no commentary.',
  'Be concise and natural. Match the tone of the voice samples when they are supplied.',
  'Do not invent facts, dates, attachments, or commitments that are not in the original message.',
  'Do not include quoted original text unless the user asked for it.',
  'Write the reply so it can be sent as-is after one read.',
].join('\n');

export type GenerateDraftResult =
  | { ok: true; draft: Draft; shadowed: boolean }
  | { ok: false; error: string };

export type DraftActionResult = { ok: true } | { ok: false; error: string };

function clip(value: string, max: number): string {
  return value.replace(/\s+\n/g, '\n').trim().slice(0, max);
}

function cleanDraft(raw: string): string {
  return raw
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*subject:\s*.*\n?/i, '')
    .replace(/^\s*body:\s*/i, '')
    .trim();
}

function buildPrompt(message: Message, body: string | undefined, samples: string[]): string {
  const original = clip(body || message.preview, 4_000);
  const voice = samples.length
    ? `\n\nRecent replies the user approved (match this voice, do not copy facts):\n${samples
        .map((sample, index) => `--- sample ${index + 1} ---\n${clip(sample, 1_200)}`)
        .join('\n')}`
    : '';

  return [
    `Write a reply to this email.`,
    '',
    `From: ${message.from} <${message.fromAddress}>`,
    `Subject: ${message.subject}`,
    `Date: ${message.date.slice(0, 10)}`,
    '',
    original,
    voice,
  ].join('\n');
}

export async function generateDraft(
  message: Message,
  body?: string,
): Promise<GenerateDraftResult> {
  const gate = await consumeAiCall();
  if (!gate.allowed) {
    const error = gate.reason ?? 'Millo cannot draft right now.';
    await logActivity({
      type: 'draft_error',
      outcome: 'error',
      detail: `Draft skipped: ${error}`,
      targetType: 'thread',
      targetId: message.threadId,
      subject: message.subject,
    });
    return { ok: false, error };
  }

  const samples = await loadVoiceSamples(3);
  const response = await streamChat({
    system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(message, body, samples) }],
    maxTokens: 800,
  });

  if (!response.ok) {
    await logActivity({
      type: 'draft_error',
      outcome: 'error',
      detail: `Draft failed: ${response.error}`,
      targetType: 'thread',
      targetId: message.threadId,
      subject: message.subject,
    });
    return { ok: false, error: response.error };
  }

  const bodyText = cleanDraft(response.text);
  if (!bodyText) {
    const error = 'The provider returned an empty draft.';
    await logActivity({
      type: 'draft_error',
      outcome: 'error',
      detail: error,
      targetType: 'thread',
      targetId: message.threadId,
      subject: message.subject,
    });
    return { ok: false, error };
  }

  const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
  const draft = await createDraft({
    threadId: message.threadId,
    messageId: message.id,
    to: message.fromAddress,
    subject,
    body: bodyText,
  });

  await logActivity({
    type: 'draft_generated',
    outcome: 'ok',
    detail: `${gate.shadowed ? 'Shadow mode — ' : ''}Generated a draft reply to ${message.from}. Send is ${
      gate.shadowed ? 'disabled until shadow mode is off' : 'waiting for approval'
    }.`,
    targetType: 'thread',
    targetId: message.threadId,
    subject,
  });

  return { ok: true, draft, shadowed: gate.shadowed };
}

/** Generate a polite nudge for a thread that has gone cold. */
export async function generateFollowUpDraft(
  message: Message,
  waitingOn: 'reply' | 'them',
): Promise<GenerateDraftResult> {
  const gate = await consumeAiCall();
  if (!gate.allowed) {
    const error = gate.reason ?? 'Millo cannot draft a follow-up right now.';
    await logActivity({
      type: 'follow_up_draft_error',
      outcome: 'error',
      detail: `Follow-up draft skipped: ${error}`,
      targetType: 'thread',
      targetId: message.threadId,
      subject: message.subject,
    });
    return { ok: false, error };
  }

  const samples = await loadVoiceSamples(3);
  const voice = samples.length
    ? `\n\nRecent replies the user approved (match this voice, do not copy facts):\n${samples
        .map((sample, index) => `--- sample ${index + 1} ---\n${clip(sample, 1_200)}`)
        .join('\n')}`
    : '';
  const prompt = [
    waitingOn === 'reply'
      ? 'The last message in this thread is from them and is still waiting for the user\'s reply.'
      : 'The user sent the last message and has not heard back. Nudge them for a response.',
    '',
    `From: ${message.from} <${message.fromAddress}>`,
    `Subject: ${message.subject}`,
    `Date: ${message.date.slice(0, 10)}`,
    '',
    clip(message.preview, 2_000),
    voice,
  ].join('\n');

  const response = await streamChat({
    system: FOLLOW_UP_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 500,
  });
  if (!response.ok) {
    await logActivity({
      type: 'follow_up_draft_error',
      outcome: 'error',
      detail: `Follow-up draft failed: ${response.error}`,
      targetType: 'thread',
      targetId: message.threadId,
      subject: message.subject,
    });
    return { ok: false, error: response.error };
  }

  const bodyText = cleanDraft(response.text);
  if (!bodyText) {
    const error = 'The provider returned an empty follow-up.';
    await logActivity({
      type: 'follow_up_draft_error',
      outcome: 'error',
      detail: error,
      targetType: 'thread',
      targetId: message.threadId,
      subject: message.subject,
    });
    return { ok: false, error };
  }

  const subject = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
  const draft = await createDraft({
    threadId: message.threadId,
    messageId: message.id,
    to: message.fromAddress,
    subject,
    body: bodyText,
  });

  await logActivity({
    type: 'follow_up_draft',
    outcome: 'ok',
    detail: `${gate.shadowed ? 'Shadow mode — ' : ''}Prepared a follow-up nudge to ${message.from}. Send is ${
      gate.shadowed ? 'disabled until shadow mode is off' : 'waiting for approval'
    }.`,
    targetType: 'thread',
    targetId: message.threadId,
    subject,
  });

  return { ok: true, draft, shadowed: gate.shadowed };
}

export async function sendDraft(draft: Draft): Promise<DraftActionResult> {
  const gate = checkGuardrails('manual');
  if (!gate.allowed) {
    return { ok: false, error: gate.reason ?? 'Sending is disabled right now.' };
  }

  try {
    const message = draft.messageId ? await loadMessage(draft.messageId) : null;
    await getMailSync(message?.accountId).send({
      to: draft.to,
      subject: draft.subject,
      text: draft.body,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Send failed.',
    };
  }

  await setDraftStatus(draft.id, 'sent');
  await addVoiceSample(draft.body);
  await logActivity({
    type: 'draft_sent',
    outcome: 'ok',
    detail: `Approved and sent the draft reply to ${draft.to}. Sends cannot be undone.`,
    targetType: 'draft',
    targetId: draft.id,
    subject: draft.subject,
  });
  return { ok: true };
}

export async function discardDraft(draft: Draft): Promise<DraftActionResult> {
  await setDraftStatus(draft.id, 'discarded');
  await logActivity({
    type: 'draft_discarded',
    outcome: 'skipped',
    detail: `Discarded the draft reply to ${draft.to}.`,
    targetType: 'draft',
    targetId: draft.id,
    subject: draft.subject,
  });
  return { ok: true };
}

/** Called after an edited draft was sent through the compose screen. */
export async function recordEditedDraftSent(draftId: string, body: string): Promise<void> {
  const draft = await getDraft(draftId);
  if (!draft) return;
  await setDraftStatus(draftId, 'sent');
  await addVoiceSample(body);
  await logActivity({
    type: 'draft_sent',
    outcome: 'ok',
    detail: `Sent an edited draft reply to ${draft.to}. Sends cannot be undone.`,
    targetType: 'draft',
    targetId: draft.id,
    subject: draft.subject,
  });
}
