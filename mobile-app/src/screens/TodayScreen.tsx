/**
 * Today — the agent's daily briefing (home screen).
 * MVP-UI §4.1 · DB: AI-Native (conversational briefing), Empty States,
 * Contextual Live Badge (status as atomic message).
 */
import React, { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ConfirmDialog, EmptyState, SectionLabel, Toast } from '../components/ui';
import { StatusStrip } from '../components/agent';
import { IconMenu, IconPower, IconSparkle, IconToday } from '../components/Icons';
import { mayAct, setKillSwitch, useGuardrails } from '../lib/guardrails';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type TodayScreenProps = {
  onOpenSettings: () => void;
  onOpenMail: () => void;
  onOpenAgent: () => void;
};

export function TodayScreen({ onOpenSettings, onOpenMail, onOpenAgent }: TodayScreenProps) {
  const [running, setRunning] = useState(false);
  const [confirmKill, setConfirmKill] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { killSwitch: killEngaged } = useGuardrails();

  const runTriage = () => {
    if (!mayAct()) {
      setToast(killEngaged ? 'Autonomy is paused — turn the kill switch off first.' : 'Shadow mode is on — Millo will not act.');
      setTimeout(() => setToast(null), 3000);
      return;
    }
    setRunning(true);
    setTimeout(() => setRunning(false), 1500);
  };

  const confirmKillToggle = () => {
    void setKillSwitch(!killEngaged);
    setConfirmKill(false);
  };

  return (
    <View style={styles.screen}>
      <Toast visible={!!toast} message={toast ?? ''} ok={false} />
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
        <StatusStrip status={killEngaged ? 'quiet' : running ? 'running' : 'idle'} />
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
});
