/**
 * AppShell — tab navigation, onboarding gate, and sync auto-start.
 * MVP-UI §2 · DB: bottom nav, one primary action per screen.
 *
 * Two things happen at boot that used to not happen at all:
 *
 *  1. The onboarding flag is read from disk. It was pure React state before, so
 *     the wizard reappeared on every launch and the email/key the user typed
 *     was discarded each time.
 *  2. If an account is already saved, the sync engine starts on its own. A user
 *     who configured email yesterday should find their inbox populated today
 *     without having to visit Settings again.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabBar, type TabId } from './components/BottomTabBar';
import { Drawer } from './components/Drawer';
import { EdgeSwipe } from './components/EdgeSwipe';
import { TopBar } from './components/TopBar';
import { TodayScreen } from './screens/TodayScreen';
import { MailScreen } from './screens/MailScreen';
import { AgentScreen } from './screens/AgentScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Onboarding } from './screens/Onboarding';
import { loadAccount } from './lib/accountStore';
import { getMailSync } from './lib/mailSyncSingleton';
import { countUnreadMessages } from './lib/mailStore';
import {
  configureNotifications,
  getNotificationPrefs,
  loadNotificationPrefs,
  setAppBadgeCount,
} from './lib/notifications';
import { loadGuardrails } from './lib/guardrails';
import {
  startTriageScheduler,
  stopTriageScheduler,
} from './lib/agent/triageScheduler';
import {
  startFollowUpScheduler,
  stopFollowUpScheduler,
} from './lib/agent/followUpScheduler';
import { isOnboarded, setOnboarded } from './lib/prefs';
import type { MailFilter } from './lib/mail';
import { colors } from './theme/theme';

export function AppShell() {
  // null means "still reading storage" — distinct from false, which means
  // "definitely not onboarded". Rendering onboarding during that unknown window
  // would flash the wizard at an already-configured user.
  const [onboarded, setOnboardedState] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabId>('today');
  const [unreadCount, setUnreadCount] = useState(0);
  // Bumped when a notification asks for a specific thread, so MailScreen
  // remounts even if the Mail tab was already showing.
  const [mailRequest, setMailRequest] = useState(0);

  // Drawer state
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | undefined>();
  const threadIdRef = useRef<string | undefined>(undefined);
  const draftIdRef = useRef<string | undefined>(undefined);
  const filterRef = useRef<MailFilter | undefined>(undefined);
  const composeRef = useRef(false);

  const switchTab = (next: TabId) => {
    if (next !== 'mail') {
      threadIdRef.current = undefined;
      draftIdRef.current = undefined;
      filterRef.current = undefined;
      composeRef.current = false;
    }
    setTab(next);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [flag, account] = await Promise.all([isOnboarded(), loadAccount(), loadGuardrails()]);
      if (cancelled) return;
      setOnboardedState(flag);
      // Resume syncing for an already-configured account. Errors are surfaced
      // by the engine's own state (MailScreen reads it), not thrown here.
      if (account) {
        void getMailSync().start({
          imap: account.imap,
          smtp: account.smtp,
          auth: { user: account.email, password: account.password },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!onboarded) return;
    void startTriageScheduler();
    void startFollowUpScheduler();
    return () => {
      stopTriageScheduler();
      stopFollowUpScheduler();
    };
  }, [onboarded]);

  // Keep the tab badge and launcher badge in step with the cached unread count.
  // MailSync emits after imports, IDLE pushes, and local read/star/delete actions.
  useEffect(() => {
    if (!onboarded) return;
    let cancelled = false;
    const refresh = async () => {
      let next = 0;
      try {
        next = await countUnreadMessages();
      } catch {
        next = 0;
      }
      if (cancelled) return;
      setUnreadCount(next);
      void setAppBadgeCount(next);
    };
    void refresh();
    const unsubscribe = getMailSync().subscribe(() => {
      void refresh();
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [onboarded]);

  // Ask for the OS notification permission once the app is configured. The
  // first-run prompt is the only reliable moment before mail starts arriving.
  useEffect(() => {
    if (!onboarded) return;
    void (async () => {
      await loadNotificationPrefs();
      await configureNotifications(getNotificationPrefs().enabled);
    })();
  }, [onboarded]);

  // A notification tap deep-links to the conversation. This listener is also
  // installed before first paint so a cold start from the tray is not lost.
  useEffect(() => {
    let cancelled = false;
    let subscription: Notifications.EventSubscription | undefined;

    const openResponse = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | undefined;
      if (data?.followUps === true) {
        setTab('today');
        return;
      }
      const target =
        typeof data?.threadId === 'string'
          ? data.threadId
          : typeof data?.messageId === 'string'
            ? data.messageId
            : undefined;
      if (!target) return;
      threadIdRef.current = target;
      draftIdRef.current = undefined;
      filterRef.current = undefined;
      composeRef.current = false;
      setMailRequest((value) => value + 1);
      setTab('mail');
    };

    void (async () => {
      try {
        const last = await Notifications.getLastNotificationResponseAsync();
        if (!cancelled && last) {
          openResponse(last);
          Notifications.clearLastNotificationResponse();
        }
      } catch {
        // No response / unsupported platform — the live listener still works.
      }
      if (cancelled) return;
      subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  const finishOnboarding = () => {
    void setOnboarded(true);
    setOnboardedState(true);
  };

  if (onboarded === null) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.boot}>
            <ActivityIndicator color={colors.primary} />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (!onboarded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <Onboarding onDone={finishOnboarding} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const handleOpenDrawer = () => setDrawerVisible(true);
  const handleCloseDrawer = () => setDrawerVisible(false);
  const handleNewChat = () => {
    switchTab('agent');
    handleCloseDrawer();
  };
  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id);
    switchTab('agent');
    handleCloseDrawer();
  };
  const handleOpenInbox = () => {
    threadIdRef.current = undefined;
    draftIdRef.current = undefined;
    filterRef.current = undefined;
    composeRef.current = false;
    switchTab('mail');
    handleCloseDrawer();
  };
  const handleOpenActions = () => {
    switchTab('activity');
    handleCloseDrawer();
  };
  const handleOpenSettings = () => {
    switchTab('settings');
    handleCloseDrawer();
  };
  const handleOpenMailThread = (threadId: string) => {
    threadIdRef.current = threadId;
    draftIdRef.current = undefined;
    filterRef.current = undefined;
    composeRef.current = false;
    switchTab('mail');
    handleCloseDrawer();
  };
  const handleOpenDraft = (draftId: string) => {
    draftIdRef.current = draftId;
    threadIdRef.current = undefined;
    filterRef.current = undefined;
    composeRef.current = false;
    switchTab('mail');
  };
  const handleOpenMailFilter = (filter: MailFilter) => {
    filterRef.current = filter;
    threadIdRef.current = undefined;
    draftIdRef.current = undefined;
    composeRef.current = false;
    switchTab('mail');
  };
  const handleOpenCompose = () => {
    composeRef.current = true;
    threadIdRef.current = undefined;
    draftIdRef.current = undefined;
    filterRef.current = undefined;
    switchTab('mail');
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.background}>
          <TopBar />
          <View style={styles.screen}>
            {tab === 'today' && (
              <TodayScreen
                onOpenDrawer={handleOpenDrawer}
                onOpenMail={(messageId) => {
                  threadIdRef.current = messageId;
                  draftIdRef.current = undefined;
                  filterRef.current = undefined;
                  composeRef.current = false;
                  switchTab('mail');
                }}
                onOpenMailFilter={handleOpenMailFilter}
                onCompose={handleOpenCompose}
                onOpenAgent={() => switchTab('agent')}
                onEditDraft={handleOpenDraft}
              />
            )}
            {tab === 'mail' && (
              <MailScreen
                key={`mail-${mailRequest}`}
                onOpenAgent={() => switchTab('agent')}
                onOpenSettings={() => switchTab('settings')}
                threadId={threadIdRef.current}
                draftId={draftIdRef.current}
                initialFilter={filterRef.current}
                composeOnOpen={composeRef.current}
              />
            )}
            {tab === 'agent' && (
              <AgentScreen
                onOpenDrawer={handleOpenDrawer}
                conversationId={activeConversationId}
                onConversationChange={setActiveConversationId}
                onOpenMailThread={handleOpenMailThread}
              />
            )}
            {tab === 'activity' && <ActivityScreen />}
            {tab === 'settings' && <SettingsScreen />}
          </View>
          <BottomTabBar active={tab} onSelect={switchTab} unreadCount={unreadCount} />
          <EdgeSwipe onOpen={handleOpenDrawer} />
          <Drawer
            visible={drawerVisible}
            onClose={handleCloseDrawer}
            onNewChat={handleNewChat}
            onSelectConversation={handleSelectConversation}
            onOpenInbox={handleOpenInbox}
            onOpenActions={handleOpenActions}
            onOpenSettings={handleOpenSettings}
            activeConversationId={activeConversationId}
          />
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'column' },
  safe: { flex: 1 },
  boot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  screen: { flex: 1 },
  background: { flex: 1, backgroundColor: colors.bg },
});
