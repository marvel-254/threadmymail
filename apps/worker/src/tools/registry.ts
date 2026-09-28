/**
 * Tool registry — the single namespace through which the agent affects the world.
 *
 * DESIGN RULES (docs/AI-SKILLS.md §4.8). Every tool must:
 *   1. return structured data, not prose meant for a human
 *   2. be idempotent where possible — a retried call must not double-send
 *   3. declare its permission scopes — checked BEFORE execution
 *   4. declare reversibility — so the undo stack knows what it can roll back
 *   5. truncate sanely — a tool returning 500 KB has failed
 *   6. never return secrets
 *
 * PERMISSIONS. A skill only ever receives the tools named in its
 * `allowed_tools` array. That is a security boundary, not a convenience: a
 * prompt-injected email cannot widen a skill's reach, because the model is
 * never shown a tool it was not granted.
 */

import type { Db } from '../db/client.js';
import type { BodyStore } from '../storage/bodystore.js';

export type Permission =
  | `network:${string}`
  | `data:${string}:read`
  | `data:${string}:write`;

export type ToolSource = 'builtin' | `plugin:${string}`;

export interface ToolContext {
  /** The user the run belongs to. Every query is scoped by this. */
  userId: string;
  /** Postgres access. Tools MUST scope every query by `userId`. */
  db: Db;
  /** Opaque blob store for email bodies/attachments. Postgres holds only keys. */
  bodies: BodyStore;
  /** The run being executed, for tool_calls bookkeeping. */
  runId: string;
  /** Skill that invoked the tool, or null for a direct chat turn. */
  skillId: string | null;
  /** Human-readable summary of the tool call, for the activity feed. */
  describe(action: { summary: string; reversible?: boolean; undoRef?: string }): Promise<void>;
  /** Model routing. */
  model: { primary: string; background: string };
  /** Emit a progress frame to a connected client. */
  emit(frame: Record<string, unknown>): void;
  /** True while the user has the kill switch engaged. Tools should bail early. */
  isAborted(): boolean;
}

export interface ToolDefinition<TArgs = Record<string, unknown>, TResult = unknown> {
  /** Namespaced: `todo.create`, `email.search`, `notion.notes_append`. */
  name: string;
  /**
   * THE SINGLE HIGHEST-LEVERAGE STRING IN THIS FILE.
   *
   * This is the model's only basis for deciding whether and how to call the
   * tool. Vague descriptions produce wrong calls. Be explicit about when the
   * tool applies, when it does not, and what it returns.
   */
  description: string;
  /** JSON Schema for the arguments. Must be complete — the model relies on it. */
  parameters: Record<string, unknown>;
  /** Checked before execution. */
  permissions: Permission[];
  /** True when the action can be undone via the activity feed. */
  reversible: boolean;
  /** Outward-facing, irreversible, or otherwise dangerous → dry-run aware. */
  sideEffecting?: boolean;
  /** Namespaced owner. */
  source: ToolSource;
  execute(args: TArgs, ctx: ToolContext): Promise<TResult>;
}

/** A structured failure. Tools return this rather than throwing. */
export interface ToolError {
  ok: false;
  error: { code: string; message: string };
}

export type ToolResult<T = unknown> = ({ ok: true; data: T } & { summary?: string }) | ToolError;

export function ok<T>(data: T, summary?: string): ToolResult<T> {
  return { ok: true, data, summary };
}

export function fail(code: string, message: string): ToolError {
  return { ok: false, error: { code, message } };
}

export const ERROR = {
  NOT_FOUND: 'NOT_FOUND',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_ARGS: 'INVALID_ARGS',
  NEEDS_CONNECTION: 'NEEDS_CONNECTION',
  NEEDS_REAUTH: 'NEEDS_REAUTH',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const;

/**
 * The erased form the registry stores.
 *
 * `TArgs` is erased to `any` on purpose: each tool infers its own argument type
 * from the annotated `execute` implementation, and the registry must hold tools
 * of differing shapes in one map. Using `never` here instead would make the
 * contextual type of `execute` unusable and force every implementation to restate
 * its signature.
 */
export type AnyTool = ToolDefinition<any, unknown>;

/** Define a tool, inferring its argument type from the `execute` implementation. */
export function defineTool<TArgs, TResult>(
  tool: ToolDefinition<TArgs, TResult>,
): AnyTool {
  return tool as unknown as AnyTool;
}

export class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  register<TArgs, TResult>(tool: ToolDefinition<TArgs, TResult>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as unknown as AnyTool);
    return this;
  }

  registerAll(tools: readonly AnyTool[]): this {
    for (const t of tools) this.register(t);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  /** Every registered tool. Used by `/tools` and the skill editor. */
  all(): AnyTool[] {
    return [...this.tools.values()];
  }

  /**
   * Narrow a tool set to an allowlist. A skill only ever sees what it was
   * granted — the model is never shown a tool outside this set.
   *
   * Unknown names are reported rather than silently dropped, so a typo in a
   * skill's `allowed_tools` is visible instead of quietly weakening it.
   */
  restrict(allowed: readonly string[]): { tools: AnyTool[]; missing: string[] } {
    const tools: AnyTool[] = [];
    const missing: string[] = [];
    for (const name of allowed) {
      const tool = this.tools.get(name);
      if (tool) tools.push(tool);
      else missing.push(name);
    }
    return { tools, missing };
  }

  /** Convert to the OpenAI/OpenRouter function-calling wire format. */
  toFunctions(tools: readonly AnyTool[]) {
    return tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  /**
   * Check a tool's permissions against what the user actually granted.
   * Called BEFORE execute. Plugins can only use what was approved at install.
   */
  checkPermissions(tool: AnyTool, granted: ReadonlySet<Permission> | null): ToolError | null {
    if (!tool.permissions.length) return null;
    // `granted === null` means a built-in tool with no user-grant requirement.
    if (granted === null) return null;

    const missing = tool.permissions.filter((p) => !granted.has(p));
    if (!missing.length) return null;

    return fail(
      ERROR.FORBIDDEN,
      `Tool "${tool.name}" is not permitted. Missing: ${missing.join(', ')}. ` +
        `Grant it under Plugins, or use a skill that is allowed to.`,
    );
  }
}
