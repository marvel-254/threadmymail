/**
 * Shared MailSync singleton.
 *
 * The engine is created once and reused across screens so IDLE is not started
 * twice and the connection is not duplicated. Screens subscribe to it rather
 * than constructing their own.
 */
import { createMailBridge } from './mailBridge';
import { MailSync } from './mailSync';

let instance: MailSync | null = null;

export function getMailSync(): MailSync {
  if (!instance) {
    instance = new MailSync(createMailBridge());
  }
  return instance;
}
