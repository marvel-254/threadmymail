/**
 * Gated tools — fully specified, and honest about the one thing they cannot do.
 *
 * WHY THIS FILE EXISTS
 *
 * Google OAuth is deliberately the **last item of the final phase** (decision
 * 2026-09-28, docs/PLAN.md §9). Every Gmail and Calendar capability the agent
 * is documented to have (docs/AI-SKILLS.md §4.1–4.2) therefore cannot be
 * implemented yet. There were two ways to handle that:
 *
 *   ✗ Omit the tools. The model never sees the capability, so it cannot tell
 *     the user "I can do that once your mail is connected", and every frontend
 *     call 404s — which reads as a bug, not as a missing connection.
 *
 *   ✓ Register them, fully described, and fail with NEEDS_CONNECTION. The UI
 *     gets a truthful state to render, the attempt is logged in tool_calls,
 *     and when the connection lands each tool is reimplemented in place with
 *     no change to its name, schema, or description.
 *
 * HARD RULE: a gated tool must never pretend to work. `ok({ data: [] })` from a
 * tool that did not run is a silent no-op that looks like success — the exact
 * failure mode this codebase calls out elsewhere ("failing loudly beats a
 * silent no-op that looks like it worked", frontend/src/lib/api.js).
 *
 * Each gated tool checks the real connection state at call time, so a tool that
 * has been connected but not yet implemented keeps failing — with INTERNAL
 * instead of NEEDS_CONNECTION — rather than silently lying.
 */

import { ERROR, fail, type Permission, type ToolContext, type ToolDefinition } from './registry';

/** The provider slug used in `oauth_tokens.provider`. */
export const GOOGLE_PROVIDER = 'google';

/**
 * True when the user has a usable Google connection. A row flagged
 * `needs_reauth` does not count — the refresh token is dead and the agent must
 * report that rather than attempt a call that will 401 (docs/GOOGLE_OAUTH.md).
 */
export async function googleConnected(ctx: ToolContext): Promise<boolean> {
  const row = await ctx.db.one<{ id: string }>(
    `SELECT id FROM oauth_tokens
      WHERE user_id = $1 AND provider = $2 AND needs_reauth = FALSE
      LIMIT 1`,
    [ctx.userId, GOOGLE_PROVIDER],
  );
  return row !== null;
}

/**
 * The message the model receives. Deliberately actionable: it names what is
 * missing and what to do, because the model relays this text to the user.
 */
export function needsConnectionMessage(onceConnected: string): string {
  return (
    'Your Google account is not connected yet, so this cannot run. ' +
    `Once it is connected, this tool will ${onceConnected}. ` +
    'Tell the user they need to connect Google — do not retry.'
  );
}

export interface GatedSpec {
  /** Namespaced tool name: `email.send`, `calendar.create_event`. */
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permissions: Permission[];
  /** True when the action can be undone from the activity feed. */
  reversible?: boolean;
  /** Outward-facing or irreversible → dry-run aware (docs/AI-SKILLS.md §6). */
  sideEffecting?: boolean;
  /** Completes the sentence "Once it is connected, this tool will …". */
  onceConnected: string;
}

/**
 * Build a tool that declares its full contract and refuses to run until Google
 * is connected. See the file header — this is a deliberate placeholder, not a
 * stub that swallows calls.
 */
export function gatedTool(spec: GatedSpec): ToolDefinition<Record<string, unknown>, unknown> {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    permissions: spec.permissions,
    reversible: spec.reversible ?? false,
    sideEffecting: spec.sideEffecting,
    source: 'builtin',
    async execute(_args, ctx) {
      if (!(await googleConnected(ctx))) {
        return fail(ERROR.NEEDS_CONNECTION, needsConnectionMessage(spec.onceConnected));
      }
      // Connected, but the implementation has not landed. Never fabricate a
      // result here — an empty success would be indistinguishable from real
      // work in the activity feed.
      return fail(
        ERROR.NOT_IMPLEMENTED,
        `${spec.name} is specified but not implemented yet. ` +
          'Google is connected; the tool itself is still pending (Phase 2).',
      );
    },
  };
}
