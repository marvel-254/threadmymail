/**
 * Today — the agent's daily briefing (home screen).
 * MVP-UI §4.1 · DB: AI-Native (conversational briefing), Empty States,
 * Contextual Live Badge (status as atomic message).
 */
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, SectionLabel } from '../components/ui';
import { StatusStrip } from '../components/agent';
import { IconMenu, IconPower, IconSparkle, IconToday } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type TodayScreenProps = {
  onOpenSettings: () => void;
  onOpenMail: () => void;
  onOpenAgent: () => void;
};

export function TodayScreen({ onOpenSettings, onOpenMail, onOpenAgent }: TodayScreenProps) {
  const [running, setRunning] = useState(false);
  const [killEngaged, setKillEngaged] = useState(false);

  const runTriage = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 1500);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityLabel="Menu" onPress={onOpenSettings} style={styles.headerBtn}>
          <IconMenu size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Today</Text>
        <Pressable
          accessibilityLabel="Kill switch"
          onLongPress={() => setKillEngaged((k) => !k)}
          style={[styles.headerBtn, killEngaged && styles.killEngaged]}
        >
          <IconPower size={22} color={killEngaged ? colors.danger : colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.greeting}>Good day.</Text>

        <Button
          label={running ? 'Running triage…' : 'Run morning triage'}
          onPress={runTriage}
          loading={running}
          fullWidth
          icon={<IconSparkle size={18} color={colors.textOnPrimary} />}
        />

        <SectionLabel>Needs your eye</SectionLabel>
        <EmptyState
          icon={<IconToday size={48} color={colors.textSubtle} />}
          title="Nothing needs you"
          body="Millo will surface anything that needs a decision."
        />

        <SectionLabel>Agent status</SectionLabel>
        <StatusStrip status={killEngaged ? 'quiet' : 'idle'} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    minHeight: 56,
  },
  headerBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  killEngaged: { backgroundColor: colors.dangerBg },
  headerTitle: { ...typography.h3, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  greeting: { ...typography.h1, color: colors.text },
});
