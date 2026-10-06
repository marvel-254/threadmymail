/**
 * Agent-specific components — AgentBubble, ToolChip, EscalationCard, StatusStrip.
 * DB: Streaming (token-by-token), Disclaimer (the agent is named, not anonymous),
 * Feedback Loop (thumbs), Typing indicators, Contextual Live Badge.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconCheck, IconThumbDown, IconThumbUp, IconX } from './Icons';

/* ── TypingIndicator (3-dot pulse) ─────────────────────────────────────── */
export function TypingIndicator() {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];

  useEffect(() => {
    const anims = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 150),
          Animated.timing(d, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 300, useNativeDriver: true }),
        ]),
      ),
    );
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [dots]);

  return (
    <View style={styles.typingRow}>
      {dots.map((d, i) => (
        <Animated.View key={i} style={[styles.typingDot, { opacity: d }]} />
      ))}
    </View>
  );
}

/* ── AgentBubble ───────────────────────────────────────────────────────── */
type AgentBubbleProps = {
  text: string;
  streaming?: boolean;
  showFeedback?: boolean;
};

export function AgentBubble({ text, streaming = false, showFeedback = false }: AgentBubbleProps) {
  const [feedback, setFeedback] = useState<'up' | 'down' | null>(null);

  return (
    <View style={styles.bubbleWrap}>
      <Text style={styles.agentLabel}>Millo</Text>
      <View style={styles.bubble}>
        <Text style={styles.bubbleText}>{text}</Text>
        {streaming && <TypingIndicator />}
      </View>
      {showFeedback && !streaming && (
        <View style={styles.feedbackRow}>
          <Pressable
            accessibilityLabel="Good response"
            onPress={() => setFeedback(feedback === 'up' ? null : 'up')}
            style={({ pressed }) => [styles.feedbackBtn, pressed && { opacity: 0.7 }]}
          >
            <IconThumbUp color={feedback === 'up' ? colors.primary : colors.textMuted} />
          </Pressable>
          <Pressable
            accessibilityLabel="Bad response"
            onPress={() => setFeedback(feedback === 'down' ? null : 'down')}
            style={({ pressed }) => [styles.feedbackBtn, pressed && { opacity: 0.7 }]}
          >
            <IconThumbDown color={feedback === 'down' ? colors.danger : colors.textMuted} />
          </Pressable>
        </View>
      )}
    </View>
  );
}

/* ── ToolChip ──────────────────────────────────────────────────────────── */
type ToolChipProps = {
  name: string;
  args?: string;
  latencyMs?: number;
  ok?: boolean;
  running?: boolean;
};

export function ToolChip({ name, args, latencyMs, ok, running = false }: ToolChipProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Pressable
      accessibilityLabel={`Tool ${name}`}
      onPress={() => setExpanded((e) => !e)}
      style={({ pressed }) => [
        styles.toolChip,
        running && styles.toolChipRunning,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={styles.toolName}>{name}</Text>
      <Text style={styles.toolArgs} numberOfLines={expanded ? undefined : 1}>
        {args}
      </Text>
      {latencyMs !== undefined && <Text style={styles.toolLatency}>{latencyMs}ms</Text>}
      {running ? (
        <TypingIndicator />
      ) : ok ? (
        <IconCheck size={14} color={colors.success} />
      ) : (
        <IconX size={14} color={colors.danger} />
      )}
    </Pressable>
  );
}

/* ── EscalationCard ────────────────────────────────────────────────────── */
type EscalationCardProps = {
  question: string;
  choices: { label: string; primary?: boolean }[];
  onChoose: (label: string) => void;
};

export function EscalationCard({ question, choices, onChoose }: EscalationCardProps) {
  const [answered, setAnswered] = useState<string | null>(null);

  return (
    <View style={styles.escalation}>
      <Text style={styles.escalationQuestion}>{question}</Text>
      <View style={styles.escalationChoices}>
        {choices.map((c) => {
          const chosen = answered === c.label;
          return (
            <Pressable
              key={c.label}
              accessibilityRole="button"
              accessibilityLabel={c.label}
              onPress={() => {
                setAnswered(c.label);
                onChoose(c.label);
              }}
              style={({ pressed }) => [
                styles.escalationBtn,
                c.primary && styles.escalationBtnPrimary,
                chosen && styles.escalationBtnChosen,
                answered && !chosen && styles.escalationBtnDim,
                pressed && { opacity: 0.85 },
              ]}
            >
              <Text
                style={[
                  styles.escalationBtnText,
                  c.primary && { color: colors.textOnPrimary },
                  chosen && { color: colors.textOnPrimary },
                ]}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ── StatusStrip ───────────────────────────────────────────────────────── */
type StatusStripProps = {
  status: 'idle' | 'running' | 'quiet';
  budgetPct?: number;
  quietHours?: string;
};

export function StatusStrip({ status, budgetPct, quietHours }: StatusStripProps) {
  const dotColor = { idle: colors.success, running: colors.primary, quiet: colors.warn }[status];
  const label = { idle: 'Idle', running: 'Running', quiet: 'Quiet hours' }[status];

  return (
    <View style={styles.statusStrip} accessibilityLabel={`Agent ${label.toLowerCase()}`}>
      <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      <Text style={styles.statusText}>{label}</Text>
      {budgetPct !== undefined && <Text style={styles.statusMeta}>budget {budgetPct}% left</Text>}
      {quietHours && <Text style={styles.statusQuiet}>quiet {quietHours}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  typingRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
  typingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textMuted },
  bubbleWrap: { alignSelf: 'flex-start', maxWidth: '85%', gap: 4 },
  agentLabel: { ...typography.label, color: colors.textSubtle, fontSize: 10, marginLeft: 4 },
  bubble: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderTopLeftRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleText: { ...typography.body, color: colors.text },
  feedbackRow: { flexDirection: 'row', gap: spacing.sm, marginLeft: 4 },
  feedbackBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  toolChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: touch.minTarget,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toolChipRunning: { borderColor: colors.borderPrimary },
  toolName: { ...typography.mono, color: colors.primary, fontWeight: '600' },
  toolArgs: { ...typography.mono, color: colors.textMuted, flexShrink: 1 },
  toolLatency: { ...typography.caption, color: colors.textSubtle },
  escalation: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
    padding: spacing.lg,
    gap: spacing.md,
  },
  escalationQuestion: { ...typography.body, color: colors.text, fontWeight: '600' },
  escalationChoices: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  escalationBtn: {
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
  },
  escalationBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  escalationBtnChosen: { backgroundColor: colors.primary, borderColor: colors.primary },
  escalationBtnDim: { opacity: 0.4 },
  escalationBtnText: { ...typography.bodySmall, color: colors.text, fontWeight: '600' },
  statusStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { ...typography.bodySmall, color: colors.textMuted },
  statusMeta: { ...typography.caption, color: colors.textSubtle },
  statusQuiet: { ...typography.caption, color: colors.warn },
});
