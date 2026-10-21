/**
 * Notifications — local new-mail alerts and the launcher badge.
 *
 * Everything here is on-device only: no push token, no Expo service, no server.
 * Mail arrives through the IMAP IDLE connection and the sync engine hands the
 * new headers to `notifyNewMessages`, which applies the user's preferences and
 * the shared guardrail gate before scheduling a local notification.
 *
 * Storage: like `prefs.ts` / `guardrails.ts`, preferences live in SecureStore.
 * They are not secrets, but SecureStore is already linked and this avoids
 * adding AsyncStorage for a few booleans and a mute list.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { checkGuardrails } from './guardrails';
import type { Message } from './mail';

const PREFS_KEY = 'threadmymail.notifications.v1';
const ALERT_CHANNEL = 'mail-alerts';
const SILENT_CHANNEL = 'mail-silent';

export type NotificationPrefs = {
  enabled: boolean;
  sound: boolean;
  vibrate: boolean;
  /** Lower-cased email addresses whose mail never raises an alert. */
  mutedSenders: string[];
};

const DEFAULT_PREFS: NotificationPrefs = {
  enabled: true,
  sound: true,
  vibrate: true,
  mutedSenders: [],
};

let state: NotificationPrefs = { ...DEFAULT_PREFS };
const listeners = new Set<(next: NotificationPrefs) => void>();
let loadPromise: Promise<void> | null = null;
let handlerInstalled = false;
let channelsReady = false;
const notifiedIds = new Set<string>();

function emit() {
  state = { ...state, mutedSenders: [...state.mutedSenders] };
  listeners.forEach((listener) => listener(state));
}

function normalizePrefs(raw: unknown): NotificationPrefs {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const muted = Array.isArray(record.mutedSenders) ? record.mutedSenders : [];
  return {
    enabled: record.enabled !== false,
    sound: record.sound !== false,
    vibrate: record.vibrate !== false,
    mutedSenders: Array.from(
      new Set(
        muted
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      ),
    ),
  };
}

export function getNotificationPrefs(): NotificationPrefs {
  return state;
}

export function subscribeNotificationPrefs(
  listener: (next: NotificationPrefs) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read persisted preferences. Safe to call repeatedly; reads once. */
export function loadNotificationPrefs(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await SecureStore.getItemAsync(PREFS_KEY);
      state = normalizePrefs(raw ? JSON.parse(raw) : null);
    } catch {
      state = { ...DEFAULT_PREFS };
    }
    emit();
  })();
  return loadPromise;
}

async function persistPrefs(): Promise<void> {
  try {
    await SecureStore.setItemAsync(PREFS_KEY, JSON.stringify(state));
  } catch {
    // Non-fatal: in-memory prefs still apply for this session.
  }
}

/** Patch preferences, persist them, and refresh Android channels. */
export async function setNotificationPrefs(patch: Partial<NotificationPrefs>): Promise<void> {
  state = normalizePrefs({ ...state, ...patch });
  emit();
  await persistPrefs();
  channelsReady = false;
  void configureChannels();
}

/** Extract and add a muted sender. Returns false when the input is not an address. */
export async function muteSender(value: string): Promise<boolean> {
  const match = value.match(/[^\s<>,;]+@[^\s<>,;]+/);
  const address = (match?.[0] ?? '').replace(/[.,;]+$/, '').toLowerCase();
  if (!address) return false;
  if (state.mutedSenders.includes(address)) return true;
  await setNotificationPrefs({ mutedSenders: [...state.mutedSenders, address] });
  return true;
}

export async function unmuteSender(address: string): Promise<void> {
  const target = address.toLowerCase();
  await setNotificationPrefs({
    mutedSenders: state.mutedSenders.filter((item) => item !== target),
  });
}

/** Install the foreground presentation handler once. */
export function installNotificationHandler(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const sound = state.sound;
      return {
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: sound,
        shouldSetBadge: false,
      };
    },
  });
}

async function configureChannels(): Promise<void> {
  if (Platform.OS !== 'android' || channelsReady) return;
  channelsReady = true;
  const common = {
    importance: Notifications.AndroidImportance.HIGH,
    showBadge: true,
    enableLights: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: state.vibrate,
  };
  try {
    await Promise.all([
      Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
        ...common,
        name: 'New mail',
        description: 'Alerts for new unread mail.',
        sound: 'default',
      }),
      Notifications.setNotificationChannelAsync(SILENT_CHANNEL, {
        ...common,
        name: 'New mail (silent)',
        description: 'New unread mail without a sound.',
        sound: null,
      }),
    ]);
  } catch {
    channelsReady = false;
  }
}

/**
 * Prepare the notification subsystem. Requests the OS permission when asked;
 * returns whether notifications are currently allowed.
 */
export async function configureNotifications(requestPermission = false): Promise<boolean> {
  installNotificationHandler();
  await loadNotificationPrefs();
  await configureChannels();
  try {
    if (requestPermission) {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted) return true;
      const requested = await Notifications.requestPermissionsAsync();
      return requested.granted;
    }
    const current = await Notifications.getPermissionsAsync();
    return current.granted;
  } catch {
    return false;
  }
}

/** Mirror the unread count onto the launcher icon. Best effort. */
export async function setAppBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, Math.round(count)));
  } catch {
    // Some launchers do not support badging; the in-app badge still works.
  }
}

/** True for obvious automated/newsletter senders that should not buzz the phone. */
export function isBulkMessage(message: Message): boolean {
  const local = message.fromAddress.toLowerCase().split('@')[0] ?? '';
  return /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|notifications?|newsletters?|mailer[-_.]?daemon|bounces?|marketing|promotions?|digest)([+._-].*)?$/.test(
    local,
  );
}

export function isSenderMuted(address: string): boolean {
  const target = address.trim().toLowerCase();
  if (!target) return false;
  return state.mutedSenders.includes(target);
}

/** Whether a freshly arrived message qualifies for an alert right now. */
export function shouldNotify(message: Message): boolean {
  if (!state.enabled) return false;
  if (!message.unread) return false;
  if (isSenderMuted(message.fromAddress)) return false;
  if (isBulkMessage(message)) return false;
  return checkGuardrails('notification').allowed;
}

/**
 * Schedule one local notification per qualifying new message. The guardrail
 * gate covers the kill switch, shadow mode, and quiet hours; notification
 * preferences cover the on/off switch and muted senders.
 */
export async function notifyNewMessages(messages: Message[]): Promise<void> {
  await loadNotificationPrefs();
  if (!state.enabled) return;
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) return;
  } catch {
    return;
  }
  const fresh = messages.filter((message) => {
    if (notifiedIds.has(message.id)) return false;
    if (!shouldNotify(message)) return false;
    notifiedIds.add(message.id);
    return true;
  });
  if (fresh.length === 0) return;

  // Keep the tray readable after a burst; the badge count carries the rest.
  for (const message of fresh.slice(0, 5)) {
    const channelId = state.sound ? ALERT_CHANNEL : SILENT_CHANNEL;
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: message.from || message.fromAddress || 'New mail',
          body: message.subject,
          sound: state.sound ? 'default' : false,
          data: { messageId: message.id, threadId: message.threadId },
        },
        trigger: Platform.OS === 'android' ? { channelId } : null,
      });
    } catch {
      // A failed alert must never break the sync loop.
    }
  }
}

/**
 * One summary alert for cold threads. Returns false when notifications are
 * disabled, permission is missing, or a guardrail blocks the alert.
 */
export async function notifyFollowUps(count: number): Promise<boolean> {
  if (count <= 0) return false;
  await loadNotificationPrefs();
  if (!state.enabled) return false;
  if (!checkGuardrails('notification').allowed) return false;
  try {
    const permissions = await Notifications.getPermissionsAsync();
    if (!permissions.granted) return false;
  } catch {
    return false;
  }
  const channelId = state.sound ? ALERT_CHANNEL : SILENT_CHANNEL;
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: count === 1 ? '1 thread went cold' : `${count} threads went cold`,
        body: 'Open Today to review them and write a nudge.',
        sound: state.sound ? 'default' : false,
        data: { followUps: true },
      },
      trigger: Platform.OS === 'android' ? { channelId } : null,
    });
    return true;
  } catch {
    return false;
  }
}

/** React binding for the notification preferences. */
export function useNotificationPrefs(): NotificationPrefs {
  const [snapshot, setSnapshot] = useState(getNotificationPrefs);

  useEffect(() => {
    setSnapshot(getNotificationPrefs());
    const unsubscribe = subscribeNotificationPrefs(setSnapshot);
    void loadNotificationPrefs();
    return unsubscribe;
  }, []);

  return snapshot;
}
