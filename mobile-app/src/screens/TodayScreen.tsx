/**
 * Today — the agent's daily briefing (home screen).
 * Nordic design: calm, information-first briefing with one primary CTA.
 * MVP-UI §4.1 · DB: AI-Native (conversational briefing), Empty States,
 * Contextual Live Badge (status as atomic message).
 *
 * Everything on this screen is live: stats come from the mail cache, the sync
 * card subscribes to the engine, and needs-your-eye comes from classifier
 * verdicts (with a cached-flag fallback before the first triage run).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Button, ConfirmDialog, EmptyState, Toast, SectionHeader } from '../components/ui';
import { StatusStrip } from '../components/agent';
import { DraftCard } from '../components/drafts';
import { SyncBanner } from '../components/inbox';
import {
  IconAgent,
  IconMenu,
  IconPower,
  IconSend,
  IconSparkle,
  IconToday,
} from '../components/Icons';
import {
  formatQuietHours,
  isQuietHours,
  setKillSwitch,
  useGuardrails,
} from '../lib/guardrails';
import { cancelTriage, runTriage, useTriage } from '../lib/agent/triage';
import { loadLatestTriageRun, loadNeedsEye, type NeedsEyeItem } from '../lib/agent/triageStore';
import { usePendingDrafts, type Draft } from '../lib/agent/draftStore';
import {
  discardDraft,
  generateFollowUpDraft,
  sendDraft as sendQueuedDraft,
} from '../lib/agent/drafts';
import {
  loadFollowUps,
  type FollowUp,
} from '../lib/agent/followUps';
import { snoozeFollowUp } from '../lib/agent/followUpStore';
import { loadSkills } from '../lib/skillsStore';
import { loadAccounts } from '../lib/accountStore';
import {
  getMailSync,
  registerMailAccounts,
  subscribeAllMailSync,
} from '../lib/mailSyncSingleton';
import {
  INITIAL_SYNC_STATE,
  type MailFilter,
  type Message,
  type SyncState,
} from '../lib/mail';
import { loadMessages } from '../lib/mailStore';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';

const VERDICT_LABEL = {
  'needs-reply': 'Needs reply',
  'action-required': 'Action required',
} as const;

function greeting(now = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 17) return 'Good afternoon.';
  return 'Good evening.';
}

function syncedLabel(iso: string | null): string {
  if (!iso) return 'Not yet';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 60_000) return 'Just now';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type AttentionItem = {
  id: string;
  type: 'draft' | 'followup' | 'needsEye';
  priority: number; // lower = more urgent
  draft?: Draft;
  followUp?: FollowUp;
  needsEye?: NeedsEyeItem;
};

export function TodayScreen({
  onOpenDrawer,
  onOpenMail,
  onOpenMailFilter,
  onCompose,
  onOpenAgent,
  onEditDraft,
}: TodayScreenProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sync, setSync] = useState<SyncState>(INITIAL_SYNC_STATE);
  const [refreshing, setRefreshing] = useState(false);
  const [needsEye, setNeedsEye] = useState<NeedsEyeItem[]>([]);
  const [triageHasRun, setTriageHasRun] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [followUpsOn, setFollowUpsOn] = useState(false);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const triage = useTriage();
  const pendingDrafts = usePendingDrafts();
  const guardrails = useGuardrails();
  const killEngaged = guardrails.killSwitch;
  const quietNow = isQuietHours();
  const budgetPct = Math.max(
    0,
    Math.round(((guardrails.dailyActionLimit - guardrails.actionsUsed) / guardrails.dailyActionLimit) * 100),
  );

  // Live cache + sync state, same source MailScreen reads.
  useEffect(() => {
    let mounted = true;
    const reload = () => {
      void loadMessages().then((rows) => {
        if (mounted) setMessages(rows);
      });
    };
    reload();
    setSync(getMailSync().getState());
    const unsubscribe = subscribeAllMailSync((_accountId, state) => {
      if (!mounted) return;
      setSync(state);
      reload();
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!triage.lastRunAt) return;
    let cancelled = false;
    void loadMessages().then((rows) => {
      if (!cancelled) setMessages(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [triage.lastRunAt]);

  useEffect(() => {
    let cancelled = false;
    void loadSkills().then((skills) => {
      if (!cancelled) setFollowUpsOn(skills.follow_ups);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!followUpsOn) {
      setFollowUps([]);
      return;
    }
    let cancelled = false;
    void loadFollowUps().then((items) => {
      if (!cancelled) setFollowUps(items);
    });
    return () => {
      cancelled = true;
    };
  }, [
    followUpsOn,
    messages,
    triage.lastRunAt,
    guardrails.loaded,
    guardrails.followUpDays,
  ]);

  useEffect(() => {
    let cancelled = false;
    void loadNeedsEye().then((items) => {
      if (!cancelled) setNeedsEye(items);
    });
    void loadLatestTriageRun().then((run) => {
      if (!cancelled) setTriageHasRun(!!run);
    });
    return () => {
      cancelled = true;
    };
  }, [triage.lastRunAt]);

  const lastSeenRun = useRef<number | null>(null);
  useEffect(() => {
    if (
      !triage.lastRunAt
      || triage.lastRunAt === lastSeenRun.current
      || !triage.lastSummary
    ) {
      return;
    }
    lastSeenRun.current = triage.lastRunAt;
    setToast({ text: triage.lastSummary, ok: triage.lastStatus === 'completed' });
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [triage.lastRunAt, triage.lastStatus, triage.lastSummary]);

  const stats = useMemo(() => ({
    unread: messages.filter((m) => m.unread).length,
    needsReply: messages.filter((m) => m.needsReply).length,
    starred: messages.filter((m) => m.starred).length,
  }), [messages]);

  // Before the first classifier run, fall back to the cached needs-reply flag.
  const fallbackNeedsEye = useMemo<NeedsEyeItem[]>(() => {
    if (triageHasRun) return [];
    return messages
      .filter((m) => m.unread && m.needsReply)
      .slice(0, 5)
      .map((m) => ({
        message: m,
        verdict: 'needs-reply',
        reason: 'Cached as needing a reply — run triage for a reviewed verdict.',
        runId: 'local-flags',
        classifiedAt: new Date(m.date).getTime(),
      }));
  }, [messages, triageHasRun]);

  const visibleNeedsEye = needsEye.length > 0 ? needsEye : fallbackNeedsEye;

  // Build unified attention list (priority: drafts → followups → needsEye)
  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];
    // Drafts are most actionable
    pendingDrafts.forEach((d, i) => items.push({
      id: `draft-${d.id}`,
      type: 'draft',
      priority: i,
      draft: d,
    }));
    // Follow-ups next
    followUps.forEach((f, i) => items.push({
      id: `followup-${f.thread.id}`,
      type: 'followup',
      priority: 100 + i,
      followUp: f,
    }));
    // Needs-eye last (classified items)
    visibleNeedsEye.forEach((n, i) => items.push({
      id: `eyes-${n.message.id}`,
      type: 'needsEye',
      priority: 200 + i,
      needsEye: n,
    }));
    return items.sort((a, b) => a.priority - b.priority);
  }, [pendingDrafts, followUps, visibleNeedsEye]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void loadAccounts()
      .then((accounts) => {
        if (accounts.length === 0) {
          setSync((current) => ({ ...current, phase: 'offline' }));
          return undefined;
        }
        registerMailAccounts(accounts);
        return Promise.all(accounts.map((account) => getMailSync(account.id).start({
          imap: account.imap,
          smtp: account.smtp,
          auth: { user: account.email, password: account.password },
        })));
      })
      .finally(() => setRefreshing(false));
  }, []);

  const handleRunTriage = () => {
    if (triage.running) {
      cancelTriage();
      return;
    }
    void runTriage({ trigger: 'manual' });
  };

  const handleSendDraft = async (draft: Parameters<typeof sendQueuedDraft>[0]) => {
    if (draftBusy) return;
    setDraftBusy(draft.id);
    const result = await sendQueuedDraft(draft);
    setDraftBusy(null);
    setToast(result.ok
      ? { text: `Draft sent to ${draft.to}`, ok: true }
      : { text: result.error, ok: false });
  };

  const handleDiscardDraft = async (draft: Parameters<typeof discardDraft>[0]) => {
    if (draftBusy) return;
    setDraftBusy(draft.id);
    await discardDraft(draft);
    setDraftBusy(null);
    setToast({ text: 'Draft discarded', ok: true });
  };

  const handleNudge = async (item: FollowUp) => {
    if (followBusy) return;
    setFollowBusy(item.thread.id);
    const result = await generateFollowUpDraft(item.thread.latest, item.waitingOn);
    setFollowBusy(null);
    if (!result.ok) {
      setToast({ text: result.error, ok: false });
      return;
    }
    setToast({ text: 'Follow-up draft added to your queue', ok: true });
    void loadFollowUps().then(setFollowUps);
  };

  const handleSnooze = async (item: FollowUp) => {
    if (followBusy) return;
    setFollowBusy(item.thread.id);
    await snoozeFollowUp(item.thread.id, 2);
    setFollowBusy(null);
    setFollowUps((current) => current.filter((entry) => entry.thread.id !== item.thread.id));
    setToast({ text: 'Follow-up snoozed for 2 days', ok: true });
  };

  const confirmKillToggle = () => {
    void setKillSwitch(!killEngaged);
    setConfirmKill(false);
  };

  const dateLine = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <View style={styles.screen}>
      <Toast visible={!!toast} message={toast?.text ?? ''} ok={toast?.ok ?? true} />
      <View style={styles.header}>
        <Pressable accessibilityLabel="Open menu" onPress={onOpenDrawer} style={styles.headerBtn}>
          <IconMenu size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Today</Text>
        <Pressable
          accessibilityLabel={killEngaged ? 'Resume autonomous actions' : 'Stop autonomous actions'}
          accessibilityHint={killEngaged ? 'Tap to resume autonomy' : 'Tap to engage the kill switch'}
          onPress={() => setConfirmKill(true)}
          style={[styles.headerBtn, killEngaged && styles.killEngaged]}
        >
          <IconPower size={22} color={killEngaged ? colors.danger : colors.textMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Greeting + context */}
        <View style={styles.greetingSection}>
          <Text style={styles.greeting}>{greeting()}</Text>
          <Text style={styles.dateLine}>{dateLine}</Text>
        </View>

        {/* Primary CTA — one prominent action */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={triage.running ? 'Cancel triage' : 'Run morning triage'}
          onPress={handleRunTriage}
          style={({ pressed }) => [styles.primaryCTA, pressed && styles.pressed]}
        >
          <IconSparkle size={20} color={colors.textOnPrimary} />
          <Text style={styles.primaryCTAText}>
            {triage.running ? 'Cancel triage' : 'Run morning triage'}
          </Text>
        </Pressable>

        {/* Sync status — inline, honest */}
        <View style={styles.syncBar}>
          <View style={styles.syncDot} />
          <Text style={styles.syncText}>
            {sync.phase === 'importing'
              ? `Syncing… ${sync.imported} imported`
              : sync.phase === 'error'
                ? `Sync error`
                : sync.lastSyncedAt
                  ? `Last synced ${syncedLabel(sync.lastSyncedAt)}`
                  : 'Not yet synced'}
          </Text>
          {sync.phase === 'importing' && sync.progress > 0 && (
            <View style={styles.syncProgressTrack}>
              <Animated.View style={[styles.syncProgressFill, { width: `${sync.progress}%` }]} />
            </View>
          )}
        </View>

        {/* Quick actions row — secondary */}
        <View style={styles.quickRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compose email"
            onPress={onCompose}
            style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
          >
            <IconSend size={18} color={colors.text} />
            <Text style={styles.quickText}>Compose</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask Millo"
            onPress={onOpenAgent}
            style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
          >
            <IconAgent size={18} color={colors.text} />
            <Text style={styles.quickText}>Ask Millo</Text>
          </Pressable>
        </View>

        {/* Compact metrics — one line, no KPI tiles */}
        <View style={styles.metricsRow}>
          {stats.unread > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${stats.unread} unread messages`}
              onPress={() => onOpenMailFilter('unread')}
              style={styles.metricChip}
            >
              <Text style={styles.metricValue}>{stats.unread}</Text>
              <Text style={styles.metricLabel}>Unread</Text>
            </Pressable>
          )}
          {stats.needsReply > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${stats.needsReply} need reply`}
              onPress={() => onOpenMailFilter('needs_reply')}
              style={styles.metricChip}
            >
              <Text style={styles.metricValue}>{stats.needsReply}</Text>
              <Text style={styles.metricLabel}>Need reply</Text>
            </Pressable>
          )}
          {stats.starred > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${stats.starred} starred`}
              onPress={() => onOpenMailFilter('starred')}
              style={styles.metricChip}
            >
              <Text style={styles.metricValue}>{stats.starred}</Text>
              <Text style={styles.metricLabel}>Starred</Text>
            </Pressable>
          )}
        </View>

        {/* Unified attention list */}
        {attentionItems.length === 0 ? (
          <View style={styles.emptyAttention}>
            <IconToday size={48} color={colors.textSubtle} />
            <Text style={styles.emptyAttentionTitle}>All caught up</Text>
            <Text style={styles.emptyAttentionBody}>
              Millo will surface anything that needs a decision.
            </Text>
          </View>
        ) : (
          <>
            {attentionItems.map((item) => {
              if (item.type === 'draft') {
                const d = item.draft!;
                return (
                  <DraftCard
                    key={item.id}
                    draft={d}
                    shadow={guardrails.shadowMode}
                    busy={draftBusy === d.id}
                    onSend={() => void handleSendDraft(d)}
                    onEdit={() => onEditDraft(d.id)}
                    onDiscard={() => void handleDiscardDraft(d)}
                  />
                );
              }
              if (item.type === 'followup') {
                const f = item.followUp!;
                return (
                  <View key={item.id} style={styles.attentionCard}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Follow up with ${f.thread.latest.from}: ${f.thread.subject}`}
                      onPress={() => onOpenMail(f.thread.latest.id)}
                      style={({ pressed }) => [styles.attentionBody, pressed && styles.pressed]}
                    >
                      <View style={styles.attentionTop}>
                        <Text style={styles.attentionSender} numberOfLines={1}>{f.thread.latest.from}</Text>
                        <View style={styles.attentionBadge}>
                          <Text style={styles.attentionBadgeText}>{f.daysCold}d cold</Text>
                        </View>
                      </View>
                      <Text style={styles.attentionSubject} numberOfLines={1}>{f.thread.subject}</Text>
                      <Text style={styles.attentionReason} numberOfLines={2}>
                        {f.waitingOn === 'reply' ? 'Waiting on your reply' : 'Waiting on them'}
                        {' · '}
                        {f.thread.messageCount} message{f.thread.messageCount === 1 ? '' : 's'}
                      </Text>
                    </Pressable>
                    <View style={styles.attentionActions}>
                      <Button
                        label="Draft nudge"
                        loading={followBusy === f.thread.id}
                        onPress={() => void handleNudge(f)}
                      />
                      <Button
                        label="Snooze 2d"
                        variant="secondary"
                        disabled={followBusy === f.thread.id}
                        onPress={() => void handleSnooze(f)}
                      />
                    </View>
                  </View>
                );
              }
              // needsEye
              const n = item.needsEye!;
              const dangerous = n.verdict === 'action-required';
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${VERDICT_LABEL[n.verdict]}: ${n.message.subject} from ${n.message.from}`}
                  onPress={() => onOpenMail(n.message.id)}
                  style={({ pressed }) => [styles.attentionCard, pressed && styles.pressed]}
                >
                  <View style={styles.attentionTop}>
                    <Text style={styles.attentionSender} numberOfLines={1}>{n.message.from}</Text>
                    <View style={[styles.attentionBadge, dangerous && styles.attentionBadgeDanger]}>
                      <Text style={styles.attentionBadgeText}>
                        {VERDICT_LABEL[n.verdict]}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.attentionSubject} numberOfLines={1}>{n.message.subject}</Text>
                  <Text style={styles.attentionReason} numberOfLines={2}>{n.reason}</Text>
                </Pressable>
              );
            })}
          </>
        )}

        {/* Agent status */}
        <StatusStrip
          status={killEngaged || quietNow ? 'quiet' : triage.running ? 'running' : 'idle'}
          actionsUsed={guardrails.actionsUsed}
          actionsLimit={guardrails.dailyActionLimit}
          budgetPct={budgetPct}
          quietHours={guardrails.quietHoursEnabled
            ? formatQuietHours(guardrails.quietStart, guardrails.quietEnd)
            : undefined}
        />
      </ScrollView>

      <ConfirmDialog
        visible={confirmKill}
        title={killEngaged ? 'Resume autonomous actions?' : 'Stop all autonomous actions?'}
        body={killEngaged
          ? 'Millo will start triaging, drafting, and following up again.'
          : 'Millo will stop triaging, drafting, and following up. You can still read and send mail yourself.'}
        confirmLabel={killEngaged ? 'Resume' : 'Stop'}
        destructive={!killEngaged}
        onConfirm={confirmKillToggle}
        onCancel={() => setConfirmKill(false)}
      />
    </View>
  );
}

type TodayScreenProps = {
  onOpenDrawer: () => void;
  onOpenMail: (messageId?: string) => void;
  onOpenMailFilter: (filter: MailFilter) => void;
  onCompose: () => void;
  onOpenAgent: () => void;
  onEditDraft: (draftId: string) => void;
};

const styles = themedStyles(() => ({
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
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },
  greetingSection: { gap: spacing.xs },
  greeting: { ...typography.h1, color: colors.text },
  dateLine: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.xs },

  // Primary CTA
  primaryCTA: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 56,
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.xl,
  },
  primaryCTAText: { ...typography.body, color: colors.textOnPrimary, fontWeight: '600' },

  // Sync bar
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  syncDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  syncText: { ...typography.bodySmall, color: colors.textMuted, flex: 1 },
  syncProgressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: colors.border,
    borderBottomLeftRadius: radii.md,
    borderBottomRightRadius: radii.md,
    overflow: 'hidden',
  },
  syncProgressFill: { height: 3, backgroundColor: colors.primary },

  // Quick actions
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quick: {
    flex: 1,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  quickPressed: { opacity: 0.85 },
  quickText: { ...typography.caption, color: colors.text, fontWeight: '600' },

  // Compact metrics
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  metricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
  },
  metricValue: { ...typography.h3, color: colors.text, fontWeight: '600' },
  metricLabel: { ...typography.caption, color: colors.textMuted },

  // Attention items
  emptyAttention: { alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  emptyAttentionTitle: { ...typography.h3, color: colors.text, textAlign: 'center' },
  emptyAttentionBody: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },

  attentionCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  attentionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  attentionSender: { ...typography.caption, color: colors.textMuted, flex: 1 },
  attentionBadge: {
    backgroundColor: colors.primaryBg,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  attentionBadgeDanger: { backgroundColor: colors.dangerBg },
  attentionBadgeText: { ...typography.caption, color: colors.primaryText, fontWeight: '600' },
  attentionSubject: { ...typography.body, color: colors.text, fontWeight: '600', marginTop: spacing.xs },
  attentionReason: { ...typography.caption, color: colors.textMuted },
  attentionBody: { gap: spacing.xs },
  attentionActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },

  pressed: { opacity: 0.85 },
}));

export default TodayScreen;