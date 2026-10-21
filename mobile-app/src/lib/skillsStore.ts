/**
 * Skills store — which agent capabilities the user switched on.
 *
 * Onboarding and Settings edit the same persisted record so the choice survives
 * a restart and cannot drift between screens. Like `prefs.ts` the values are
 * not secrets; SecureStore is used because it is already linked and a small
 * JSON object is well under its limit.
 *
 * Reserved for the agent engine: call `loadSkills()` (or `getEnabledSkills()`)
 * before running a skill, alongside the guardrail gate in `guardrails.ts`.
 */
import * as SecureStore from 'expo-secure-store';

const SKILLS_KEY = 'threadmymail.skills.v1';

export type SkillId = 'triage' | 'draft_replies' | 'follow_ups';

export type Skills = Record<SkillId, boolean>;

export type SkillDefinition = {
  id: SkillId;
  label: string;
  description: string;
};

export const SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    id: 'triage',
    label: 'Triage',
    description: 'Sort new mail and surface what needs a decision.',
  },
  {
    id: 'draft_replies',
    label: 'Draft replies',
    description: 'Prepare replies for your approval before anything is sent.',
  },
  {
    id: 'follow_ups',
    label: 'Follow-ups',
    description: 'Notice cold threads and remind you to nudge them.',
  },
];

export const DEFAULT_SKILLS: Skills = {
  triage: true,
  draft_replies: false,
  follow_ups: false,
};

function normalize(raw: unknown): Skills {
  const skills: Skills = { ...DEFAULT_SKILLS };
  if (!raw || typeof raw !== 'object') return skills;
  const record = raw as Record<string, unknown>;
  for (const definition of SKILL_DEFINITIONS) {
    const value = record[definition.id];
    if (typeof value === 'boolean') {
      skills[definition.id] = value;
    }
  }
  return skills;
}

/** Load the persisted skill flags, falling back to defaults on any error. */
export async function loadSkills(): Promise<Skills> {
  try {
    const raw = await SecureStore.getItemAsync(SKILLS_KEY);
    if (!raw) return { ...DEFAULT_SKILLS };
    return normalize(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_SKILLS };
  }
}

export async function saveSkills(skills: Skills): Promise<void> {
  await SecureStore.setItemAsync(SKILLS_KEY, JSON.stringify(normalize(skills)));
}

/** Update one skill and persist. Returns the new full record. */
export async function setSkill(id: SkillId, enabled: boolean): Promise<Skills> {
  const current = await loadSkills();
  const next: Skills = { ...current, [id]: enabled };
  await saveSkills(next);
  return next;
}

/** The ids the agent is currently allowed to run. */
export function getEnabledSkills(skills: Skills): SkillId[] {
  return SKILL_DEFINITIONS.map((definition) => definition.id)
    .filter((id) => skills[id]);
}

/** Convenience for the agent engine: load from disk and return enabled ids. */
export async function getEnabledSkillIds(): Promise<SkillId[]> {
  return getEnabledSkills(await loadSkills());
}
