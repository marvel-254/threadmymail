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
import { loadGuardrails } from './lib/guardrails';
import {
  startTriageScheduler,
  stopTriageScheduler,
} from './lib/agent/triageScheduler';
import { isOnboarded, setOnboarded } from './lib/prefs';
import type { MailFilter } from './lib/mail';
import { colors } from './theme/theme';

export function AppShell() {
  // null means "still reading storage" — distinct from false, which means
  // "definitely not onboarded". Rendering onboarding during that unknown window
  // would flash the wizard at an already-configured user.
  const [onboarded, setOnboardedState] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabId>('today');

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
    return stopTriageScheduler;
  }, [onboarded]);

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
          <BottomTabBar active={tab} onSelect={switchTab} />
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
