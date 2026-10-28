/**
 * Distillation — the write path of the memory engine.
 *
 * After each triage/draft/chat run, a cheap prompt asks the model to pick out
 * *durable* facts: who the user talks to, scheduling signals, standing
 * preferences, commitments, and the user's own voice. The results are merged
 * into `agent_memories` via `memoryStore`, deduplicating against existing rows
 * (bump importance rather than duplicate) and routing people into `contacts`.
 *
 * Design rules from AI-SKILLS.md §8:
 * - Remember what is durable, not what is merely recent.
 * - Every memory carries a `source_ref` back to the email that produced it.
 * - Never store secrets (secret-shaper guard lives in memoryStore).
 * - Every write/skip logs to the Activity log.
 */
import { streamChat } from '../aiClient';
import { consumeAiCall } from '../guardrails';
import {
  getContactByEmail,
  rememberMemory,
  savePerson,
  type MemoryKind,
} from './memoryStore';
import { logActivity } from './activityStore';

export type DistillCandidate = {
  kind: unknown;
  content: string;
  importance?: unknown;
  person?: string | null;
};

/** Keep distillations cheap: a single small call per run, low max tokens. */
const DISTILL_MAX_TOKENS = 600;

/** If a run had this many relevant messages, distill from all of them. */
const MAX_INPUT_MESSAGES = 60;

const DISTILL_SYSTEM = [
  'You extract durable facts from email activity for an on-device memory store.',
  'From the supplied messages and decisions, list only what is worth remembering long-term:',
  '- fact: a stable property about the user or their world (works at X, moved to Y, timezone).',
  '- preference: how the user wants things handled (reply style, quiet hours, tone).',
  '- commitment: something the user is responsible for (deadline, promised deliverable).',
  '- person: a recurring contact worth remembering — who they are, their role, how they prefer to work.',
  'Rules:',
  '- NEVER include credentials, API keys, passwords, tokens, or anything secret-looking.',
  '- Do not invent facts; only include what the input supports.',
  '- Keep each memory under 120 characters.',
  '- importance is 1-10: 8-10 for identity-level facts, 5-7 for useful context, 1-4 for minor details.',
  '- A "person" entry also sets "person" to their email address when one is clearly identifiable.',
  'Return ONLY a JSON object: {"memories":[{"kind":"fact|preference|commitment|person","content":"...","importance":5,"person":"someone@example.com"}]}.',
  'If there is nothing durable to remember, return {"memories":[]}.',
].join('\n');

export type DistillResult = {
  remembered: number;
  skipped: number;
  reason: string | null;
};

export function clip(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Serializes a run's messages + decisions into a compact distillation input. */
export function distillInput(
  items: {
    from: string;
    fromAddress: string;
    subject: string;
    date: string;
    preview: string;
    /** Triage verdict, when available. */
    verdict?: string | null;
    reason?: string | null;
  }[],
): string {
  const lines = items.slice(0, MAX_INPUT_MESSAGES).map((item, index) => {
    const parts = [
      `[${index}]`,
      `From: ${clip(item.from, 60)} <${clip(item.fromAddress, 60)}>`,
      `Subject: ${clip(item.subject, 120)}`,
      `Date: ${item.date.slice(0, 10)}`,
      `Preview: ${clip(item.preview, 160)}`,
    ];
    if (item.verdict) parts.push(`Verdict: ${item.verdict}${item.reason ? ` — ${clip(item.reason, 80)}` : ''}`);
    return parts.join('\n');
  });
  if (!lines.length) return '';
  return `Messages:\n${lines.join('\n\n')}`;
}

function isMemoryKind(value: unknown): value is MemoryKind {
  return value === 'fact' || value === 'preference' || value === 'commitment' || value === 'person';
}

function parseCandidates(text: string): DistillCandidate[] {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    const payload = JSON.parse(cleaned.slice(start, end + 1)) as { memories?: unknown };
    if (!Array.isArray(payload.memories)) return [];
    return payload.memories.filter(
      (entry): entry is DistillCandidate =>
        typeof entry === 'object'
        && entry !== null
        && typeof (entry as { content?: unknown }).content === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Runs the distillation prompt over a run's items. Bounded, budget-gated, and
 * best-effort: it must never fail a triage/draft run.
 *
 * @param sourceRef Prefix for the memory source ref (e.g. `triage:<runId>`).
 */
export async function distillFromRun(
  items: Parameters<typeof distillInput>[0],
  sourceRef: string,
): Promise<DistillResult> {
  const input = distillInput(items);
  if (!input) return { remembered: 0, skipped: 0, reason: 'no input' };

  // Gate on the same AI budget as other background work; skip silently when
  // budget is exhausted rather than fail the calling run.
  let gate;
  try {
    gate = await consumeAiCall();
  } catch {
    return { remembered: 0, skipped: 0, reason: 'budget gate error' };
  }
  if (!gate.allowed) {
    return { remembered: 0, skipped: 0, reason: gate.reason ?? 'no AI budget' };
  }

  let text: string;
  try {
    const response = await streamChat({
      system: DISTILL_SYSTEM,
      messages: [{ role: 'user', content: input }],
      maxTokens: DISTILL_MAX_TOKENS,
    });
    if (!response.ok) return { remembered: 0, skipped: 0, reason: response.error };
    if (response.text.length > 8_000) return { remembered: 0, skipped: 0, reason: 'output too large' };
    text = response.text;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { remembered: 0, skipped: 0, reason };
  }

  const candidates = parseCandidates(text);
  let remembered = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const kind = isMemoryKind(candidate.kind) ? candidate.kind : 'fact';
    const importance = Math.max(1, Math.min(10, Math.round(Number(candidate.importance) || 5)));
    const content = clip(candidate.content, 240);
    if (!content) {
      skipped += 1;
      continue;
    }

    // People get a contact row as well as a memory row.
    if (kind === 'person' && typeof candidate.person === 'string' && candidate.person.includes('@')) {
      const email = candidate.person.toLowerCase().trim();
      try {
        const existing = await getContactByEmail(email);
        if (existing) {
          // Re-save idempotently — memoryStore merges notes + bumps last_seen.
          await savePerson({ email, name: content.slice(0, 80), notes: content });
        } else {
          await savePerson({ email, name: content.slice(0, 80), notes: content });
        }
      } catch {
        // Contacts are best-effort; still attempt the memory row below.
      }
    }

    const outcome = await rememberMemory({ kind, content, importance, pinned: false, sourceRef });
    if (outcome.ok) remembered += 1;
    else skipped += 1;
  }

  await logActivity({
    type: 'memory_distill',
    outcome: remembered > 0 ? 'ok' : 'skipped',
    detail: remembered > 0
      ? `Millo remembered ${remembered} thing${remembered === 1 ? '' : 's'} from ${sourceRef}${skipped ? ` (${skipped} skipped)` : ''}.`
      : `Millo found nothing durable to remember from ${sourceRef}.`,
  });

  return { remembered, skipped, reason: null };
}