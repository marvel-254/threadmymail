/**
 * Shared MailSync registry.
 *
 * One engine per account keeps each IDLE connection independent. Screens
 * subscribe through the registry so adding or removing an account does not
 * leave a stale listener behind.
 */
import { createMailBridge } from './mailBridge';
import { MailSync } from './mailSync';
import { accountIdFromMessageId, type SyncState } from './mail';
import { setMailUndoHandler, type UndoPayload } from './agent/activityStore';

const instances = new Map<string, MailSync>();
let order: string[] = [];
const registryListeners = new Set<() => void>();

function undoAccountId(payload: UndoPayload): string {
  switch (payload.kind) {
    case 'mail_restore':
      return payload.message.accountId;
    case 'mail_thread_restore':
      return payload.messages[0]?.accountId ?? 'legacy';
    case 'mail_thread_flags':
      return accountIdFromMessageId(payload.items[0]?.messageId ?? '');
    default:
      return accountIdFromMessageId(payload.messageId);
  }
}

setMailUndoHandler((payload) => getMailSync(undoAccountId(payload)).restoreUndo(payload));

function notifyRegistry(): void {
  registryListeners.forEach((listener) => listener());
}

function getOrCreate(accountId: string): MailSync {
  let instance = instances.get(accountId);
  if (!instance) {
    instance = new MailSync(createMailBridge(), accountId);
    instances.set(accountId, instance);
  }
  return instance;
}

/** Register the connected accounts, primary first. Safe to call repeatedly. */
export function registerMailAccounts(accounts: { id: string; primary?: boolean }[]): void {
  const nextOrder = [...accounts]
    .sort((a, b) => Number(b.primary ?? false) - Number(a.primary ?? false))
    .map((account) => account.id);
  for (const id of nextOrder) getOrCreate(id);
  const changed = nextOrder.length !== order.length
    || nextOrder.some((id, index) => id !== order[index]);
  order = nextOrder;
  if (changed) notifyRegistry();
}

/** Get one account's engine, or the primary/first engine when omitted. */
export function getMailSync(accountId?: string): MailSync {
  const id = accountId ?? order[0];
  return getOrCreate(id ?? 'legacy');
}

/** Drop an engine after its connection has been stopped. */
export function removeMailSync(accountId: string): void {
  instances.delete(accountId);
  order = order.filter((id) => id !== accountId);
  notifyRegistry();
}

/** Subscribe to every registered account, including accounts added later. */
export function subscribeAllMailSync(
  listener: (accountId: string, state: SyncState) => void,
): () => void {
  const unsubs = new Map<string, () => void>();

  const bind = () => {
    const ids = new Set([...order, ...instances.keys()]);
    for (const id of ids) {
      if (unsubs.has(id)) continue;
      const engine = getOrCreate(id);
      unsubs.set(id, engine.subscribe((state) => listener(id, state)));
    }
    for (const [id, unsubscribe] of unsubs) {
      if (instances.has(id)) continue;
      unsubscribe();
      unsubs.delete(id);
    }
  };

  bind();
  registryListeners.add(bind);
  return () => {
    registryListeners.delete(bind);
    unsubs.forEach((unsubscribe) => unsubscribe());
  };
}
