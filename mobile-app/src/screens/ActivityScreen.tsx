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

const MOCK_ACTIVITY: { day: string; items: ActivityItem[] }[] = [
  {
    day: 'TODAY',
    items: [
      { id: '1', time: '08:12', runId: 'run_9c2', action: 'triage', outcome: 'ok', detail: '3 drafts' },
      { id: '2', time: '08:12', runId: 'run_9c2', action: 'sent reply', outcome: 'ok', detail: '"Re: Acme"', undoable: true },
      { id: '3', time: '07:00', runId: 'run_7aa', action: 'follow-up', outcome: 'skipped', detail: 'skipped (quiet)' },
    ],
  },
  {
    day: 'YESTERDAY',
    items: [
      { id: '4', time: '18:02', runId: 'run_5f1', action: 'triage', outcome: 'ok', detail: '2 drafts' },
      { id: '5', time: '17:45', runId: 'run_5f1', action: 'sent reply', outcome: 'ok', detail: '"Re: Vendor"', undoable: true },
      { id: '6', time: '17:45', runId: 'run_5f1', action: 'draft', outcome: 'ok', detail: 'saved' },
    ],
  },
];

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
        {MOCK_ACTIVITY.map((group) => (
          <View key={group.day}>
            <SectionLabel>{group.day}</SectionLabel>
            {group.items.map((item) => {
              const isExpanded = expanded === item.id;
              const isUndone = undone.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.time} ${item.action} ${item.detail}`}
                  onPress={() => setExpanded(isExpanded ? null : item.id)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
                >
                  <Text style={styles.time}>{item.time}</Text>
                  <Text style={styles.runId}>{item.runId}</Text>
                  <Text style={[styles.action, isUndone && styles.actionUndone]}>{item.action}</Text>
                  <Text style={styles.detail} numberOfLines={1}>
                    {item.detail}
                  </Text>
                  {outcomeIcon(item.outcome)}
                  {isExpanded && item.undoable && !isUndone && (
                    <Pressable
                      accessibilityLabel="Undo"
                      onPress={() => setUndone((s) => new Set(s).add(item.id))}
                      style={styles.undoBtn}
                    >
                      <Text style={styles.undoText}>Undo</Text>
                    </Pressable>
                  )}
                </Pressable>
              );
            })}
          </View>
        ))}
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
