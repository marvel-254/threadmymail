import { loadGuardrails, getGuardrails } from '../lib/guardrails';
import { countUnreadMessages } from '../lib/mailStore';
import { loadNeedsEye } from '../lib/agent/triageStore';
import type { MilloWidgetData } from './MilloWidget';

export async function loadWidgetData(summary?: string | null): Promise<MilloWidgetData> {
  await loadGuardrails();
  let unread = 0;
  let needsEye = 0;
  try {
    unread = await countUnreadMessages();
  } catch {
    unread = 0;
  }
  try {
    needsEye = (await loadNeedsEye(99)).length;
  } catch {
    needsEye = 0;
  }
  const guardrails = getGuardrails();
  return {
    unread,
    needsEye,
    killSwitch: guardrails.killSwitch,
    shadowMode: guardrails.shadowMode,
    summary: summary ?? null,
  };
}
