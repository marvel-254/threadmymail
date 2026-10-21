/**
 * Today — the agent's daily briefing (home screen).
 * MVP-UI §4.1 · DB: AI-Native (conversational briefing), Empty States,
 * Contextual Live Badge (status as atomic message).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ConfirmDialog, EmptyState, SectionLabel, Toast } from '../components/ui';
import { StatusStrip } from '../components/agent';
import { DraftCard } from '../components/drafts';
import { IconMenu, IconPower, IconSparkle, IconToday } from '../components/Icons';
import {
  formatQuietHours,
  isQuietHours,
  setKillSwitch,
  useGuardrails,
} from '../lib/guardrails';
import { cancelTriage, runTriage, useTriage } from '../lib/agent/triage';
import { loadNeedsEye, type NeedsEyeItem } from '../lib/agent/triageStore';
import { usePendingDrafts } from '../lib/agent/draftStore';
import { discardDraft, sendDraft as sendQueuedDraft } from '../lib/agent/drafts';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type TodayScreenProps = {
  onOpenSettings: () => void;
  onOpenMail: (messageId?: string) => void;
  onOpenAgent: () => void;
  onEditDraft: (draftId: string) => void;
};

const VERDICT_LABEL = {
  'needs-reply': 'Needs reply',
  'action-required': 'Action required',
} as const;

export function TodayScreen({
  onOpenSettings,
  onOpenMail,
  onOpenAgent,
  onEditDraft,
}: TodayScreenProps) {
  const [needsEye, setNeedsEye] = useState<NeedsEyeItem[]>([]);
  const [confirmKill, setConfirmKill] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [draftBusy, setDraftBusy] = useState<string | null>(null);
  const triage = useTriage();
  const pendingDrafts = usePendingDrafts();
  const guardrails = useGuardrails();
  const killEngaged = guardrails.killSwitch;
  const quietNow = isQuietHours();
  const budgetPct = Math.max(
    0,
    Math.round(((guardrails.dailyActionLimit - guardrails.actionsUsed) / guardrails.dailyActionLimit) * 100),
  );

  useEffect(() => {
    let cancelled = false;
    void loadNeedsEye().then((items) => {
      if (!cancelled) setNeedsEye(items);
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

  const confirmKillToggle = () => {
    void setKillSwitch(!killEngaged);
    setConfirmKill(false);
  };

  return (
    <View style={styles.screen}>
      <Toast visible={!!toast} message={toast?.text ?? ''} ok={toast?.ok ?? true} />
      <View style={styles.header}>
        <Pressable accessibilityLabel="Menu" onPress={onOpenSettings} style={styles.headerBtn}>
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

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.greeting}>Good day.</Text>

        <Button
          label={triage.running ? 'Cancel triage' : 'Run morning triage'}
          onPress={handleRunTriage}
          variant={triage.running ? 'danger' : 'primary'}
          fullWidth
          icon={<IconSparkle size={18} color={colors.textOnPrimary} />}
        />

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

        <SectionLabel>Needs your eye</SectionLabel>
        {needsEye.length === 0 ? (
          <EmptyState
            icon={<IconToday size={48} color={colors.textSubtle} />}
            title="Nothing needs you"
            body="Millo will surface anything that needs a decision."
          />
        ) : (
          needsEye.map((item) => {
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
  verdictTextDanger: { color: colors.danger },
  eyeSubject: { ...typography.body, color: colors.text, fontWeight: '600' },
  eyeReason: { ...typography.caption, color: colors.textMuted },
});
