/**
 * Today — the agent's daily briefing (home screen).
 * MVP-UI §4.1 · DB: AI-Native (conversational briefing), Empty States,
 * Contextual Live Badge (status as atomic message).
 */
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, EmptyState, SectionLabel } from '../components/ui';
import { StatusStrip } from '../components/agent';
import { IconMail, IconMenu, IconPower, IconSparkle, IconToday } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type AttentionItem = {
  id: string;
  kind: 'mail' | 'followup';
  title: string;
  meta: string;
};

const MOCK_ATTENTION: AttentionItem[] = [
  { id: '1', kind: 'mail', title: 'Contract — Acme', meta: 'reply by 5pm' },
  { id: '2', kind: 'mail', title: 'Invoice — vendor', meta: 'needs review' },
  { id: '3', kind: 'followup', title: 'Follow-up: proposal sent 3d ago', meta: 'waiting on you' },
];

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
        <Text style={styles.greeting}>Good morning, Langat.</Text>
        <Text style={styles.counts}>12 unread · 3 need a reply · 2 follow-ups</Text>

        <Button
          label={running ? 'Running triage…' : 'Run morning triage'}
          onPress={runTriage}
          loading={running}
          fullWidth
          icon={<IconSparkle size={18} color={colors.textOnPrimary} />}
        />

        <SectionLabel>Needs your eye</SectionLabel>
        {MOCK_ATTENTION.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, ${item.meta}`}
            onPress={onOpenMail}
            style={({ pressed }) => [styles.attentionCard, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.attentionIcon}>
              {item.kind === 'mail' ? (
                <IconMail size={18} color={colors.primary} />
              ) : (
                <IconSparkle size={18} color={colors.accent} />
              )}
            </View>
            <View style={styles.attentionMain}>
              <Text style={styles.attentionTitle}>{item.title}</Text>
              <Text style={styles.attentionMeta}>{item.meta}</Text>
            </View>
          </Pressable>
        ))}

        <SectionLabel>Agent status</SectionLabel>
        <StatusStrip status={killEngaged ? 'quiet' : 'idle'} budgetPct={62} quietHours="22:00" />
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
  counts: { ...typography.bodySmall, color: colors.textMuted },
  attentionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: touch.minTarget,
  },
  attentionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attentionMain: { flex: 1, gap: 2 },
  attentionTitle: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  attentionMeta: { ...typography.caption, color: colors.textMuted },
});
