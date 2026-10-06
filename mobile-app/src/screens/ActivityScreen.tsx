/**
 * Activity — the audit log (trust surface).
 * MVP-UI §4.4 · DB: Confirmation Messages (no silent actions), Undo.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EmptyState, SectionLabel } from '../components/ui';
import { IconActivity, IconBack, IconCheck, IconX } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type ActivityItem = {
  id: string;
  time: string;
  runId: string;
  action: string;
  outcome: 'ok' | 'error' | 'skipped';
  detail: string;
  undoable?: boolean;
};

export function ActivityScreen() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [undone, setUndone] = useState<Set<string>>(new Set());

  const outcomeIcon = (o: ActivityItem['outcome']) => {
    if (o === 'ok') return <IconCheck size={14} color={colors.success} />;
    if (o === 'error') return <IconX size={14} color={colors.danger} />;
    return <Text style={styles.skipped}>—</Text>;
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <EmptyState
          icon={<IconActivity size={48} color={colors.textSubtle} />}
          title="Nothing yet"
          body="Millo has not acted yet. Everything it does will appear here with the run that caused it."
        />
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
  headerBtn: { width: touch.minTarget, height: touch.minTarget },
  headerTitle: { ...typography.h3, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexWrap: 'wrap',
  },
  time: { ...typography.caption, color: colors.textSubtle, width: 40 },
  runId: { ...typography.mono, color: colors.textMuted },
  action: { ...typography.bodySmall, color: colors.text, flexShrink: 1 },
  actionUndone: { textDecorationLine: 'line-through', color: colors.textSubtle },
  detail: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  skipped: { color: colors.warn, fontSize: 12 },
  undoBtn: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  undoText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
});
