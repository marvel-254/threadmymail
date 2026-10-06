/**
 * AppShell — tab navigation + onboarding gate.
 * MVP-UI §2 · DB: bottom nav, one primary action per screen.
 */
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { BottomTabBar, type TabId } from './components/BottomTabBar';
import { TodayScreen } from './screens/TodayScreen';
import { MailScreen } from './screens/MailScreen';
import { AgentScreen } from './screens/AgentScreen';
import { ActivityScreen } from './screens/ActivityScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { Onboarding } from './screens/Onboarding';
import { colors } from './theme/theme';

export function AppShell() {
  const [onboarded, setOnboarded] = useState(false);
  const [tab, setTab] = useState<TabId>('today');

  if (!onboarded) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <Onboarding onDone={() => setOnboarded(true)} />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.screen}>
          {tab === 'today' && (
            <TodayScreen
              onOpenSettings={() => setTab('settings')}
              onOpenMail={() => setTab('mail')}
              onOpenAgent={() => setTab('agent')}
            />
          )}
          {tab === 'mail' && <MailScreen onOpenAgent={() => setTab('agent')} />}
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
  safe: { flex: 1, backgroundColor: colors.bg },
  screen: { flex: 1 },
});
