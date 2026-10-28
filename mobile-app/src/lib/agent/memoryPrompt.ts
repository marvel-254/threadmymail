/**
 * Prompt assembly helpers for the memory engine.
 *
 * The read path of AI-SKILLS.md §8: `recall(query, limit)` over FTS5 (ranked by
 * importance × recency × relevance), then inject a bounded block into the
 * system prompt of chat/draft calls. Touches `last_used_at` so recency stays
 * honest. Kept small so memory context never eats the user's token budget.
 */
import {
  getProfile,
  recallMemories,
  touchMemory,
  type MemoryKind,
} from './memoryStore';

const MAX_BLOCK_CHARS = 1_800; // bounded token budget for memory context

const KIND_LABEL: Record<MemoryKind, string> = {
  fact: 'fact',
  preference: 'preference',
  commitment: 'commitment',
  person: 'about a person',
};

/**
 * Returns a bounded, ranked memory block for the system prompt, plus the
 * memoized profile voice line. Touches `last_used_at` on recalled rows.
 */
export async function buildMemoryBlock(query: string, limit = 8): Promise<string> {
  const [results, profile] = await Promise.all([recallMemories(query, limit), getProfile()]);

  const lines: string[] = [];

  if (profile.name) lines.push(`About the user: you know them as ${profile.name}.`);
  if (profile.timezone) lines.push(`The user is in timezone ${profile.timezone}.`);
  if (profile.signOff) lines.push(`The user signs off like "${profile.signOff}".`);
  if (profile.tone) lines.push(`Preferred tone: ${profile.tone}.`);

  for (const memory of results) {
    const source = memory.sourceRef ? ` [from ${memory.sourceRef}]` : '';
    lines.push(`- (${KIND_LABEL[memory.kind]}) ${memory.content}${source}`);
    void touchMemory(memory.id).catch(() => undefined);
  }

  const joined = lines.join('\n');
  if (joined.length <= MAX_BLOCK_CHARS) return joined;

  const head = lines[0] ? `${lines[0]}\n` : '';
  const budget = MAX_BLOCK_CHARS - head.length;
  return `${head}${[...lines.slice(1)]
    .reduce((acc, line) => {
      if (acc.out.length + line.length + 1 > budget) return acc;
      acc.out.push(line);
      return acc;
    }, { out: [] as string[] })
    .out.join('\n')}`;
}

/**
 * Appends the memory block to an existing system prompt. Empty-safe: if nothing
 * is recalled, the original prompt is returned unchanged.
 */
export async function withMemoryContext(system: string, query: string, limit = 8): Promise<string> {
  const block = await buildMemoryBlock(query, limit);
  if (!block) return system;
  return [
    system,
    '---',
    'What Millo already knows (visible and editable by the user):',
    block,
    'Treat these as true unless the user corrects them. Do not repeat them back verbatim.',
  ].join('\n');
}
