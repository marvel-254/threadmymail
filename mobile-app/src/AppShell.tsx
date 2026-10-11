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
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabBar, type TabId } from './components/BottomTabBar';
import { TopBar } from './components/TopBar';
import { TodayScreen } from './screens/TodayScreen';
import { MailScreen } from './screens/MailScreen';
import { AgentScreen } from './screens/AgentScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Onboarding } from './screens/Onboarding';
import { loadAccount } from './lib/accountStore';
import { getMailSync } from './lib/mailSyncSingleton';
import { isOnboarded, setOnboarded } from './lib/prefs';
import { colors } from './theme/theme';

export function AppShell() {
  // null means "still reading storage" — distinct from false, which means
  // "definitely not onboarded". Rendering onboarding during that unknown window
  // would flash the wizard at an already-configured user.
  const [onboarded, setOnboardedState] = useState<boolean | null>(null);
  const [tab, setTab] = useState<TabId>('today');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [flag, account] = await Promise.all([isOnboarded(), loadAccount()]);
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <TopBar />
        <View style={styles.screen}>
          {tab === 'today' && (
            <TodayScreen
              onOpenSettings={() => setTab('settings')}
              onOpenMail={() => setTab('mail')}
              onOpenAgent={() => setTab('agent')}
            />
          )}
          {tab === 'mail' && (
            <MailScreen
              onOpenAgent={() => setTab('agent')}
              onOpenSettings={() => setTab('settings')}
            />
          )}
          {tab === 'agent' && <AgentScreen />}
          {tab === 'activity' && <ActivityScreen />}
          {tab === 'settings' && <SettingsScreen />}
          <BottomTabBar active={tab} onSelect={setTab} />
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
});
