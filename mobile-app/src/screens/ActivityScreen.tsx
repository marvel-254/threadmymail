/**
 * Activity — the audit log (trust surface).
 * MVP-UI §4.4 · DB: Confirmation Messages (no silent actions), Undo.
 *
 * Every agent decision, send, and sync event is written by `activityStore`.
 * This screen is a read-only projection of that table, grouped by day, with
 * working Undo for entries that carry an inverse payload.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { EmptyState, Toast } from '../components/ui';
import { IconActivity, IconCheck, IconX } from '../components/Icons';
import {
  loadActivity,
  undoActivity,
  type ActivityEntry,
  type ActivityOutcome,
} from '../lib/agent/activityStore';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

const PAGE_SIZE = 50;

type Filter = 'all' | 'agent' | 'errors';

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'agent', label: 'Agent' },
  { id: 'errors', label: 'Errors' },
];

const ACTION_LABELS: Record<string, string> = {
  triage_run: 'Triage run',
  triage_decision: 'Triage decision',
  send: 'Send',
  mark_read: 'Marked read',
  mark_unread: 'Marked unread',
  star: 'Star',
  archive: 'Archive',
  delete: 'Delete',
  sync_connect: 'Sync connected',
  sync_import: 'Sync import',
  sync_error: 'Sync error',
};

const AGENT_TYPES = new Set([
  'triage_run',
  'triage_decision',
  'draft',
  'draft_reply',
  'follow_up',
  'agent_send',
]);

type DayGroup = {
  key: string;
  label: string;
  entries: ActivityEntry[];
};

function actionLabel(type: string): string {
  return ACTION_LABELS[type] ?? type.replace(/_/g, ' ');
}

function outcomeIcon(outcome: ActivityOutcome, undone: boolean) {
  if (undone) return <Text style={styles.skipped}>↺</Text>;
  if (outcome === 'ok') return <IconCheck size={14} color={colors.success} />;
  if (outcome === 'error') return <IconX size={14} color={colors.danger} />;
  return <Text style={styles.skipped}>—</Text>;
}

function dayKey(ts: number): string {
  const date = new Date(ts);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date.toDateString() === now.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function ActivityScreen() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const showToast = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), ok ? 2200 : 3500);
  };

  useEffect(() => {
    let cancelled = false;
    void loadActivity({ limit: PAGE_SIZE, cursor: 0 }).then((rows) => {
      if (cancelled) return;
      setEntries(rows);
      setHasMore(rows.length === PAGE_SIZE);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const rows = await loadActivity({ limit: PAGE_SIZE, cursor: entries.length });
      setEntries((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } finally {
      setLoadingMore(false);
    }
  }, [entries.length, hasMore, loadingMore]);

  const visible = useMemo(() => {
    if (filter === 'errors') return entries.filter((entry) => entry.outcome === 'error');
    if (filter === 'agent') return entries.filter((entry) => AGENT_TYPES.has(entry.type));
    return entries;
  }, [entries, filter]);

  const groups = useMemo<DayGroup[]>(() => {
    const result: DayGroup[] = [];
    for (const entry of visible) {
      const key = dayKey(entry.createdAt);
      const last = result[result.length - 1];
      if (last && last.key === key) {
        last.entries.push(entry);
      } else {
        result.push({ key, label: dayLabel(entry.createdAt), entries: [entry] });
      }
    }
    return result;
  }, [visible]);

  const handleUndo = async (entry: ActivityEntry) => {
    if (undoing) return;
    setUndoing(entry.id);
    try {
      const result = await undoActivity(entry.id);
      if (result.ok) {
        setEntries((prev) => prev.map((item) => (
          item.id === entry.id ? { ...item, undone: true } : item
        )));
        showToast('Action undone');
      } else {
        showToast(result.error ?? 'Undo failed.', false);
      }
    } finally {
      setUndoing(null);
    }
  };

  return (
    <View style={styles.screen}>
      <Toast visible={!!toast} message={toast?.text ?? ''} ok={toast?.ok ?? true} />
      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>Activity</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((item) => {
          const active = filter === item.id;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setFilter(item.id)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : entries.length === 0 ? (
        <ScrollView contentContainerStyle={styles.content}>
          <EmptyState
            icon={<IconActivity size={48} color={colors.textSubtle} />}
            title="Nothing yet"
            body="Millo has not acted yet. Everything it does will appear here with the run that caused it."
          />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {groups.length === 0 && (
            <Text style={styles.noMatch}>No matching activity on this page.</Text>
          )}
          {groups.map((group) => (
            <View key={group.key} style={styles.group}>
              <Text style={styles.dayLabel}>{group.label}</Text>
              {group.entries.map((entry) => {
                const isOpen = expanded === entry.id;
                const undoable = !!entry.undoPayload && !entry.undone;
                const irreversible = entry.type === 'send' && entry.outcome === 'ok' && !entry.undone;
                return (
                  <View key={entry.id}>
                    <View style={styles.row}>
                      <Pressable
                        style={styles.rowMain}
                        accessibilityRole="button"
                        accessibilityLabel={`${actionLabel(entry.type)}: ${entry.detail}`}
                        onPress={() => setExpanded(isOpen ? null : entry.id)}
                      >
                        <View style={styles.iconWrap}>{outcomeIcon(entry.outcome, entry.undone)}</View>
                        <View style={styles.rowText}>
                          <View style={styles.rowTop}>
                            <Text style={[styles.action, entry.undone && styles.actionUndone]} numberOfLines={1}>
                              {actionLabel(entry.type)}
                            </Text>
                            <Text style={styles.time}>{formatTime(entry.createdAt)}</Text>
                          </View>
                          <Text style={styles.detail} numberOfLines={isOpen ? undefined : 2}>
                            {entry.detail}
                          </Text>
                          {!isOpen && (
                            <Text style={styles.runId} numberOfLines={1}>
                              {entry.runId ? `run ${entry.runId}` : 'manual'}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                      <View style={styles.rowActions}>
                        {undoable && (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Undo ${actionLabel(entry.type)}`}
                            disabled={undoing === entry.id}
                            onPress={() => void handleUndo(entry)}
                            style={styles.undoBtn}
                          >
                            <Text style={styles.undoText}>
                              {undoing === entry.id ? '…' : 'Undo'}
                            </Text>
                          </Pressable>
                        )}
                        {entry.undone && <Text style={styles.undoneTag}>Undone</Text>}
                        {irreversible && <Text style={styles.irreversibleTag}>Sent</Text>}
                      </View>
                    </View>
                    {isOpen && (
                      <View style={styles.expanded}>
                        <Text style={styles.expandedLine}>
                          Run: {entry.runId ?? 'manual'}
                        </Text>
                        <Text style={styles.expandedLine}>
                          Target: {entry.targetType ?? 'none'}
                          {entry.targetId ? ` · ${entry.targetId}` : ''}
                        </Text>
                        <Text style={styles.expandedLine}>
                          Outcome: {entry.outcome}
                          {entry.undone ? ' · undone' : ''}
                        </Text>
                        {entry.type === 'send' && entry.outcome === 'ok' && (
                          <Text style={styles.expandedWarn}>
                            Sends cannot be undone. This entry is kept for audit only.
                          </Text>
                        )}
                        {!entry.undoPayload && entry.type !== 'send' && (
                          <Text style={styles.expandedLine}>
                            No inverse operation was recorded for this entry.
                          </Text>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))}

          {hasMore && (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => void loadMore()}
              style={({ pressed }) => [styles.loadMore, pressed && styles.loadMorePressed]}
            >
              <Text style={styles.loadMoreText}>
                {loadingMore ? 'Loading…' : 'Load more'}
              </Text>
            </Pressable>
          )}
        </ScrollView>
      )}
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
  filters: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  group: { gap: spacing.xs },
  dayLabel: { ...typography.label, color: colors.textSubtle, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    minHeight: touch.minTarget,
  },
  iconWrap: { width: 18, alignItems: 'center', paddingTop: 2 },
  rowText: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { ...typography.bodySmall, color: colors.text, fontWeight: '600', flex: 1 },
  actionUndone: { textDecorationLine: 'line-through', color: colors.textSubtle },
  time: { ...typography.caption, color: colors.textSubtle },
  detail: { ...typography.caption, color: colors.textMuted },
  runId: { ...typography.mono, color: colors.textSubtle },
  rowActions: { alignItems: 'flex-end', paddingVertical: spacing.md, gap: spacing.xs },
  undoBtn: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 32,
    justifyContent: 'center',
  },
  undoText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  undoneTag: { ...typography.caption, color: colors.textSubtle },
  irreversibleTag: { ...typography.caption, color: colors.warn },
  expanded: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  expandedLine: { ...typography.caption, color: colors.textMuted },
  expandedWarn: { ...typography.caption, color: colors.warn },
  skipped: { color: colors.warn, fontSize: 12 },
  noMatch: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  loadMore: {
    alignSelf: 'center',
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  loadMorePressed: { backgroundColor: colors.surfaceStrong },
  loadMoreText: { ...typography.bodySmall, color: colors.text },
});
