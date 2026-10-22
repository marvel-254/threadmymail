/**
 * Today — the agent's daily briefing (home screen).
 * MVP-UI §4.1 · DB: AI-Native (conversational briefing), Empty States,
 * Contextual Live Badge (status as atomic message).
 *
 * Everything on this screen is live: stats come from the mail cache, the sync
 * card subscribes to the engine, and needs-your-eye comes from classifier
 * verdicts (with a cached-flag fallback before the first triage run).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { Button, ConfirmDialog, EmptyState, SectionLabel, Toast } from '../components/ui';
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
import { usePendingDrafts } from '../lib/agent/draftStore';
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

type TodayScreenProps = {
  onOpenDrawer: () => void;
  onOpenMail: (messageId?: string) => void;
  onOpenMailFilter: (filter: MailFilter) => void;
  onCompose: () => void;
  onOpenAgent: () => void;
  onEditDraft: (draftId: string) => void;
};

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
        <Text style={styles.greeting}>{greeting()}</Text>
        <Text style={styles.dateLine}>{dateLine}</Text>

        <View style={styles.statRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${stats.unread} unread messages`}
            onPress={() => onOpenMailFilter('unread')}
            style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
          >
            <Text style={styles.statValue}>{stats.unread}</Text>
            <Text style={styles.statLabel}>Unread</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${stats.needsReply} messages need a reply`}
            onPress={() => onOpenMailFilter('needs_reply')}
            style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
          >
            <Text style={styles.statValue}>{stats.needsReply}</Text>
            <Text style={styles.statLabel}>Needs reply</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${stats.starred} starred messages`}
            onPress={() => onOpenMailFilter('starred')}
            style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
          >
            <Text style={styles.statValue}>{stats.starred}</Text>
            <Text style={styles.statLabel}>Starred</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Last synced ${syncedLabel(sync.lastSyncedAt)}`}
            onPress={() => onOpenMailFilter('all')}
            style={({ pressed }) => [styles.stat, pressed && styles.pressed]}
          >
            <Text style={styles.statTime}>{syncedLabel(sync.lastSyncedAt)}</Text>
            <Text style={styles.statLabel}>Last sync</Text>
          </Pressable>
        </View>

        <SectionLabel>Sync</SectionLabel>
        <View style={styles.syncCard}>
          {sync.phase === 'idle' ? (
            <Text style={styles.syncIdle}>
              {sync.lastSyncedAt
                ? `Last synced ${syncedLabel(sync.lastSyncedAt)}. Pull down to sync again.`
                : 'Not syncing yet. Pull down to connect or add an account in Settings.'}
            </Text>
          ) : (
            <SyncBanner
              phase={sync.phase}
              progress={sync.progress}
              imported={sync.imported}
              cappedAt={sync.cappedAt}
              error={sync.error}
            />
          )}
        </View>

        <View style={styles.quickRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={triage.running ? 'Cancel triage' : 'Run morning triage'}
            onPress={handleRunTriage}
            style={({ pressed }) => [styles.quick, styles.quickPrimary, pressed && styles.pressed]}
          >
            <IconSparkle size={18} color={colors.textOnPrimary} />
            <Text style={[styles.quickText, styles.quickTextPrimary]}>
              {triage.running ? 'Cancel' : 'Triage'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Compose email"
            onPress={onCompose}
            style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
          >
            <IconSend size={18} color={colors.text} />
            <Text style={styles.quickText}>Compose</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask Millo"
            onPress={onOpenAgent}
            style={({ pressed }) => [styles.quick, pressed && styles.pressed]}
          >
            <IconAgent size={18} color={colors.text} />
            <Text style={styles.quickText}>Ask Millo</Text>
          </Pressable>
        </View>

        {pendingDrafts.length > 0 && (
          <>
            <SectionLabel>Drafts ({pendingDrafts.length})</SectionLabel>
            {pendingDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                shadow={guardrails.shadowMode}
                busy={draftBusy === draft.id}
                onSend={() => void handleSendDraft(draft)}
                onEdit={() => onEditDraft(draft.id)}
                onDiscard={() => void handleDiscardDraft(draft)}
              />
            ))}
          </>
        )}

        {followUpsOn && (
          <>
            <SectionLabel>Follow-ups ({followUps.length})</SectionLabel>
            {followUps.length === 0 ? (
              <Text style={styles.followEmpty}>
                No cold threads. Millo will flag conversations that have waited too long.
              </Text>
            ) : (
              followUps.map((item) => (
                <View key={item.thread.id} style={styles.eyeCard}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Follow up with ${item.thread.latest.from}: ${item.thread.subject}`}
                    onPress={() => onOpenMail(item.thread.latest.id)}
                    style={({ pressed }) => [styles.followBody, pressed && styles.pressed]}
                  >
                    <View style={styles.eyeTop}>
                      <Text style={styles.eyeSender} numberOfLines={1}>{item.thread.latest.from}</Text>
                      <View style={[styles.verdictBadge, styles.followBadge]}>
                        <Text style={styles.followBadgeText}>{item.daysCold}d cold</Text>
                      </View>
                    </View>
                    <Text style={styles.eyeSubject} numberOfLines={1}>{item.thread.subject}</Text>
                    <Text style={styles.eyeReason} numberOfLines={2}>
                      {item.waitingOn === 'reply'
                        ? 'Waiting on your reply'
                        : 'Waiting on them'}
                      {' · '}
                      {item.thread.messageCount} message{item.thread.messageCount === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                  <View style={styles.followActions}>
                    <Button
                      label="Draft nudge"
                      loading={followBusy === item.thread.id}
                      onPress={() => void handleNudge(item)}
                    />
                    <Button
                      label="Snooze 2d"
                      variant="secondary"
                      disabled={followBusy === item.thread.id}
                      onPress={() => void handleSnooze(item)}
                    />
                  </View>
                </View>
              ))
            )}
          </>
        )}

        <SectionLabel>Needs your eye</SectionLabel>
        {visibleNeedsEye.length === 0 ? (
          <EmptyState
            icon={<IconToday size={48} color={colors.textSubtle} />}
            title="Nothing needs you"
            body="Millo will surface anything that needs a decision."
          />
        ) : (
          visibleNeedsEye.map((item) => {
            const dangerous = item.verdict === 'action-required';
            return (
              <Pressable
                key={item.message.id}
                accessibilityRole="button"
                accessibilityLabel={`${VERDICT_LABEL[item.verdict]}: ${item.message.subject} from ${item.message.from}`}
                onPress={() => onOpenMail(item.message.id)}
                style={({ pressed }) => [styles.eyeCard, pressed && styles.eyeCardPressed]}
              >
                <View style={styles.eyeTop}>
                  <Text style={styles.eyeSender} numberOfLines={1}>{item.message.from}</Text>
                  <View style={[styles.verdictBadge, dangerous ? styles.verdictDanger : styles.verdictPrimary]}>
                    <Text style={[styles.verdictText, dangerous && styles.verdictTextDanger]}>
                      {VERDICT_LABEL[item.verdict]}
                    </Text>
                  </View>
                </View>
                <Text style={styles.eyeSubject} numberOfLines={1}>{item.message.subject}</Text>
                <Text style={styles.eyeReason} numberOfLines={2}>{item.reason}</Text>
              </Pressable>
            );
          })
        )}

        <SectionLabel>Agent status</SectionLabel>
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
  content: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  greeting: { ...typography.h1, color: colors.text },
  dateLine: { ...typography.caption, color: colors.textMuted, marginTop: -spacing.sm },
  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stat: {
    flexGrow: 1,
    flexBasis: '46%',
    minHeight: 72,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    justifyContent: 'center',
    gap: 2,
  },
  statValue: { ...typography.h2, color: colors.text },
  statTime: { ...typography.h3, color: colors.text },
  statLabel: { ...typography.caption, color: colors.textMuted },
  syncCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  syncIdle: { ...typography.bodySmall, color: colors.textMuted },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  quick: {
    flex: 1,
    minHeight: 56,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  quickPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  quickText: { ...typography.caption, color: colors.text, fontWeight: '600' },
  quickTextPrimary: { color: colors.textOnPrimary },
  pressed: { opacity: 0.82 },
  eyeCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
    minHeight: touch.minTarget,
  },
  eyeCardPressed: { opacity: 0.85 },
  eyeTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyeSender: { ...typography.caption, color: colors.textMuted, flex: 1 },
  verdictBadge: {
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  verdictPrimary: { backgroundColor: colors.accentBg },
  verdictDanger: { backgroundColor: colors.dangerBg },
  verdictText: { ...typography.caption, color: colors.accent, fontWeight: '600' },
  verdictTextDanger: { color: colors.dangerText },
  eyeSubject: { ...typography.body, color: colors.text, fontWeight: '600' },
  eyeReason: { ...typography.caption, color: colors.textMuted },
  followEmpty: { ...typography.caption, color: colors.textMuted },
  followBody: { gap: spacing.xs },
  followBadge: { backgroundColor: colors.dangerBg },
  followBadgeText: { ...typography.caption, color: colors.dangerText, fontWeight: '600' },
  followActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
}));
