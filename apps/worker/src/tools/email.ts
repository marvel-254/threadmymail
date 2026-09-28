/**
 * Email tools.
 *
 * SPLIT BY WHAT IS ACTUALLY POSSIBLE
 *
 * Reading is local-first. The synced projection of the mailbox lives in Neon
 * (`email_messages`) and the bodies live in the D1 body store, so `email.search`,
 * `email.get` and `email.get_thread` are real implementations that need no
 * network call to Google. They work the moment a sync has populated rows.
 *
 * Everything that *changes* mail state — send, reply, draft, archive, label,
 * snooze, mark-read, attachments — is Gmail's to own. Mutating the local
 * projection instead would silently diverge from the mailbox, which is worse
 * than not doing it, so those are registered through `gatedTool` and fail with
 * NEEDS_CONNECTION until OAuth lands (see tools/gated.ts for the reasoning).
 *
 * The body of every message stays in D1. Postgres holds a `body_key`, and the
 * list tools below never select it — `email.get` is the only path that resolves
 * a body, and it truncates. The column list is shared with the REST layer
 * (`EMAIL_METADATA_COLUMNS`) so the two cannot drift.
 */

import { ERROR, fail, ok, type ToolDefinition } from './registry';
import { gatedTool } from './gated';
import { EMAIL_METADATA_COLUMNS, type Row } from '../db/client';

/** Bodies are capped on read. A 500 KB tool result is a failed tool. */
const BODY_CHAR_CAP = 20_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface EmailRow extends Row {
  id: string;
  gmail_id: string;
  thread_id: string | null;
  subject: string | null;
  from_address: string | null;
  to_addresses: string[] | null;
  snippet: string | null;
  has_attachments: boolean;
  label_ids: string[] | null;
  received_at: Date | string;
  read_at: Date | string | null;
  ai_summary: string | null;
  ai_priority: number;
}

function shapeMessage(row: EmailRow) {
  return {
    id: row.id,
    thread_id: row.thread_id,
    subject: row.subject,
    from: row.from_address,
    to: row.to_addresses ?? [],
    snippet: row.snippet,
    labels: row.label_ids ?? [],
    has_attachments: row.has_attachments,
    received_at: row.received_at,
    unread: row.read_at === null,
    ai_summary: row.ai_summary,
    ai_priority: row.ai_priority,
  };
}

/**
 * `ILIKE` metacharacters in a user/model-supplied query would otherwise act as
 * wildcards. Values are already bound parameters, so this is not injection —
 * it is about a query of "100%" matching everything.
 */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

export const emailTools: ToolDefinition<never, unknown>[] = [
  {
    name: 'email.search',
    description:
      'Search the synced mailbox and return message METADATA plus a short snippet — ' +
      'never full bodies; call email.get for those. Prefer this for "what came in", ' +
      '"what did Dana send", "anything unread from finance". Returns newest first. ' +
      'If nothing has been synced yet the result is legitimately empty, which is not ' +
      'the same as "no such mail" — say so rather than concluding the mail does not exist.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Free text matched against subject, sender address and snippet. ' +
            'Not Gmail query syntax — this searches the local projection.',
        },
        thread_id: { type: 'string', description: 'Restrict to one conversation.' },
        label: {
          type: 'string',
          description: 'Restrict to messages carrying this label id, e.g. INBOX, UNREAD.',
        },
        unread: { type: 'boolean', description: 'Only messages with no read timestamp.' },
        limit: {
          type: 'integer',
          description: 'Maximum messages to return. Default 20, maximum 50.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ['data:email:read'],
    reversible: false,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const params: unknown[] = [ctx.userId];
      const where: string[] = ['user_id = $1'];

      if (typeof a.query === 'string' && a.query.trim() !== '') {
        params.push(`%${escapeLike(a.query.trim())}%`);
        const n = params.length;
        where.push(
          `(subject ILIKE $${n} ESCAPE '\\' OR from_address ILIKE $${n} ESCAPE '\\' ` +
            `OR snippet ILIKE $${n} ESCAPE '\\')`,
        );
      }
      if (typeof a.thread_id === 'string' && a.thread_id !== '') {
        params.push(a.thread_id);
        where.push(`thread_id = $${params.length}`);
      }
      if (typeof a.label === 'string' && a.label !== '') {
        params.push(a.label);
        where.push(`$${params.length} = ANY(label_ids)`);
      }
      if (a.unread === true) {
        where.push('read_at IS NULL');
      }

      const rawLimit = typeof a.limit === 'number' && Number.isFinite(a.limit) ? a.limit : 20;
      const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 50);
      params.push(limit);

      const rows = await ctx.db.query<EmailRow>(
        `SELECT ${EMAIL_METADATA_COLUMNS} FROM email_messages
          WHERE ${where.join(' AND ')}
          ORDER BY received_at DESC
          LIMIT $${params.length}`,
        params,
      );

      const messages = rows.map(shapeMessage);
      return ok(
        {
          messages,
          count: messages.length,
          // A full page may mean there is more; the model should narrow rather
          // than assume it has seen everything.
          may_have_more: messages.length === limit,
        },
        messages.length === 1 ? '1 message' : `${messages.length} messages`,
      );
    },
  },

  {
    name: 'email.get',
    description:
      'Read ONE message in full: metadata plus the body text, resolved from the blob ' +
      'store. Use it after email.search has identified a specific message id, or when ' +
      'you need the exact wording (amounts, dates, names). The body is truncated if very ' +
      'long, in which case `body_truncated` is true — say so instead of guessing at the end.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The message id from email.search.' } },
      required: ['id'],
      additionalProperties: false,
    },
    permissions: ['data:email:read'],
    reversible: false,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      if (typeof a.id !== 'string' || !UUID_RE.test(a.id)) {
        return fail(ERROR.INVALID_ARGS, 'id must be a message UUID from email.search.');
      }

      const row = await ctx.db.one<EmailRow & { body_key: string | null }>(
        `SELECT ${EMAIL_METADATA_COLUMNS}, body_key FROM email_messages
          WHERE id = $1 AND user_id = $2`,
        [a.id, ctx.userId],
      );
      if (!row) return fail(ERROR.NOT_FOUND, `No message ${a.id} in the synced mailbox.`);

      // Absent body_key is normal for a metadata-only row — not an error.
      if (!row.body_key) {
        return ok(
          { message: shapeMessage(row), body_text: null, body_truncated: false },
          `read ${row.subject ?? '(no subject)'} (no body stored)`,
        );
      }

      const text = await ctx.bodies.getText(row.body_key);
      if (text === null) {
        // The key exists but the blob is gone (expired or never written). Flag
        // it rather than returning a message that looks empty.
        return fail(
          ERROR.NOT_FOUND,
          'The stored body for this message is missing from the body store and cannot be re-read.',
        );
      }

      const truncated = text.length > BODY_CHAR_CAP;
      return ok(
        {
          message: shapeMessage(row),
          body_text: truncated ? text.slice(0, BODY_CHAR_CAP) : text,
          body_truncated: truncated,
        },
        `read ${row.subject ?? '(no subject)'}${truncated ? ' (body truncated)' : ''}`,
      );
    },
  },

  {
    name: 'email.get_thread',
    description:
      'Read a whole conversation in order: every message in the thread as metadata ' +
      '(no bodies), with the participants. Use it to understand what was said over time ' +
      'before replying, and before committing to anything that sounds like a promise. ' +
      'Follow up with email.get on the one or two messages that actually matter.',
    parameters: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'The Gmail thread id.' },
        id: {
          type: 'string',
          description: 'Or any message id in the thread; its thread is used.',
        },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ['data:email:read'],
    reversible: false,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      let threadId: string | null =
        typeof a.thread_id === 'string' && a.thread_id !== '' ? a.thread_id : null;

      if (!threadId) {
        if (typeof a.id !== 'string' || !UUID_RE.test(a.id)) {
          return fail(ERROR.INVALID_ARGS, 'Pass either thread_id, or the id of a message in the thread.');
        }
        const anchor = await ctx.db.one<{ thread_id: string | null }>(
          `SELECT thread_id FROM email_messages WHERE id = $1 AND user_id = $2`,
          [a.id, ctx.userId],
        );
        if (!anchor) return fail(ERROR.NOT_FOUND, `No message ${a.id} in the synced mailbox.`);
        threadId = anchor.thread_id;
        if (!threadId) {
          return fail(ERROR.NOT_FOUND, 'That message has no thread id, so it stands alone.');
        }
      }

      const rows = await ctx.db.query<EmailRow>(
        `SELECT ${EMAIL_METADATA_COLUMNS} FROM email_messages
          WHERE user_id = $1 AND thread_id = $2
          ORDER BY received_at ASC
          LIMIT 100`,
        [ctx.userId, threadId],
      );
      if (!rows.length) {
        return fail(ERROR.NOT_FOUND, `No synced messages in thread ${threadId}.`);
      }

      // Participants come from the rows, so the model does not have to
      // deduplicate addresses itself.
      const participants = new Set<string>();
      for (const row of rows) {
        if (row.from_address) participants.add(row.from_address);
        for (const to of row.to_addresses ?? []) participants.add(to);
      }

      return ok(
        {
          thread_id: threadId,
          subject: rows[0]?.subject ?? null,
          participants: [...participants],
          messages: rows.map(shapeMessage),
          count: rows.length,
        },
        `${rows.length} message${rows.length === 1 ? '' : 's'} in thread`,
      );
    },
  },

  // ── Gmail-backed: registered, described, and gated (see tools/gated.ts) ────

  gatedTool({
    name: 'email.draft',
    description:
      'Create a draft reply or new message WITHOUT sending it. Use this to prepare ' +
      'wording for the user to review, or when the task is to compose rather than send. ' +
      'Never send as a way of "checking" a draft.',
    onceConnected: 'save a draft to the mailbox',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        reply_to_id: { type: 'string', description: 'Message id being replied to, if any.' },
      },
      required: ['body'],
      additionalProperties: false,
    },
    permissions: ['data:email:write'],
  }),

  gatedTool({
    name: 'email.send',
    description:
      'Send a message. Outward-facing and irreversible in practice — a sent mail cannot ' +
      'be reliably unsent — so this is gated by new_contact_policy and the daily outbound ' +
      'budget (docs/AI-SKILLS.md §6). Never send anything the user has not had a chance to ' +
      'see the intent of; prefer email.draft when unsure.',
    onceConnected: 'send a message on the user\'s behalf',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
        reply_to_id: { type: 'string' },
      },
      required: ['to', 'body'],
      additionalProperties: false,
    },
    permissions: ['data:email:write', 'network:gmail'],
    reversible: true,
    sideEffecting: true,
  }),

  gatedTool({
    name: 'email.reply',
    description:
      'Reply inside an existing conversation, preserving the threading headers so it ' +
      'lands in the same thread rather than starting a new one. Prefer this over ' +
      'email.send for anything that answers a message.',
    onceConnected: 'reply within a conversation',
    parameters: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'The message being replied to.' },
        body: { type: 'string' },
        reply_all: { type: 'boolean', description: 'Include the original recipients. Default false.' },
      },
      required: ['message_id', 'body'],
      additionalProperties: false,
    },
    permissions: ['data:email:write', 'network:gmail'],
    reversible: true,
    sideEffecting: true,
  }),

  gatedTool({
    name: 'email.archive',
    description:
      'Remove messages from the inbox without deleting them — the thread remains ' +
      'searchable and nothing is lost. This is the default way to clear noise; never ' +
      'use it on something that still needs a reply.',
    onceConnected: 'archive messages out of the inbox',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Message ids.' },
        thread_id: { type: 'string', description: 'Or archive a whole thread.' },
      },
      required: [],
      additionalProperties: false,
    },
    permissions: ['data:email:write', 'network:gmail'],
    reversible: true,
  }),

  gatedTool({
    name: 'email.label',
    description:
      'Add or remove labels on messages, to file mail under the labels the user already ' +
      'uses. Adding INBOX is how an archived message is brought back.',
    onceConnected: 'apply and remove labels',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        add: { type: 'array', items: { type: 'string' }, description: 'Label ids to add.' },
        remove: { type: 'array', items: { type: 'string' }, description: 'Label ids to remove.' },
      },
      required: ['ids'],
      additionalProperties: false,
    },
    permissions: ['data:email:write', 'network:gmail'],
    reversible: true,
  }),

  gatedTool({
    name: 'email.mark_read',
    description:
      'Mark messages as read. The user\'s preference may also archive on read, so treat ' +
      'this as "this is handled" rather than as a cosmetic change.',
    onceConnected: 'mark messages as read',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
      additionalProperties: false,
    },
    permissions: ['data:email:write', 'network:gmail'],
    reversible: true,
  }),

  gatedTool({
    name: 'email.snooze',
    description:
      'Hide a message until a given time, when it returns to the inbox unread. Use it ' +
      'for mail that is genuinely time-bound and needs nothing from you now.',
    onceConnected: 'snooze messages until a later time',
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' } },
        until: { type: 'string', description: 'ISO 8601 timestamp to return the message.' },
      },
      required: ['ids', 'until'],
      additionalProperties: false,
    },
    permissions: ['data:email:write', 'network:gmail'],
    reversible: true,
  }),

  gatedTool({
    name: 'email.extract_attachments',
    description:
      'Fetch a specific attachment on demand and store it, returning a reference. Fetch ' +
      'one at a time and only when the content is actually needed — bulk extraction costs ' +
      'storage and CPU for files nobody reads. Never send attachments (docs/AI-SKILLS.md §6).',
    onceConnected: 'fetch a named attachment',
    parameters: {
      type: 'object',
      properties: {
        message_id: { type: 'string' },
        filename: { type: 'string', description: 'Exact attachment filename to fetch.' },
      },
      required: ['message_id', 'filename'],
      additionalProperties: false,
    },
    permissions: ['data:email:read', 'network:gmail'],
    reversible: false,
  }),
] as ToolDefinition<never, unknown>[];
