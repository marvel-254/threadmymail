/**
 * Mail components — MailRow (inbox list), ThreadMessage, Composer.
 * DB: Touch targets ≥48dp, color-not-only-indicator (unread = dot + bold).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconSend, IconSparkle } from './Icons';

/* ── MailRow ───────────────────────────────────────────────────────────── */
export type MailSummary = {
  id: string;
  sender: string;
  subject: string;
  preview: string;
  time: string;
  unread: boolean;
};

type MailRowProps = {
  mail: MailSummary;
  onPress: (id: string) => void;
};

export function MailRow({ mail, onPress }: MailRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${mail.sender}, ${mail.subject}`}
      onPress={() => onPress(mail.id)}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceHover }]}
    >
      {mail.unread && <View style={styles.unreadDot} />}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{mail.sender.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.main}>
        <Text style={[styles.sender, mail.unread && styles.senderUnread]} numberOfLines={1}>
          {mail.sender}
        </Text>
        <Text style={styles.subject} numberOfLines={1}>
          {mail.subject}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {mail.preview}
        </Text>
      </View>
      <Text style={styles.time}>{mail.time}</Text>
    </Pressable>
  );
}

/* ── ThreadMessage ─────────────────────────────────────────────────────── */
export type ThreadMessage = {
  id: string;
  sender: string;
  email: string;
  time: string;
  body: string;
};

export function ThreadMessage({ msg }: { msg: ThreadMessage }) {
  return (
    <View style={styles.threadCard}>
      <Text style={styles.threadSubject}>{msg.sender}</Text>
      <Text style={styles.threadMeta}>
        {msg.email} · {msg.time}
      </Text>
      <View style={styles.threadDivider} />
      <Text style={styles.threadBody}>{msg.body}</Text>
    </View>
  );
}

/* ── Composer ──────────────────────────────────────────────────────────── */
type ComposerProps = {
  placeholder?: string;
  disabled?: boolean;
  disabledReason?: string;
  onSend: (text: string) => void;
  onAskAgent?: () => void;
};

export function Composer({ placeholder = 'type a message…', disabled = false, disabledReason, onSend, onAskAgent }: ComposerProps) {
  const [text, setText] = useState('');

  return (
    <View style={styles.composerWrap}>
      {disabled && disabledReason ? (
        <Text style={styles.disabledReason}>{disabledReason}</Text>
      ) : null}
      <View style={[styles.composer, disabled && styles.composerDisabled]}>
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          value={text}
          onChangeText={setText}
          multiline
          editable={!disabled}
          accessibilityLabel="Message the agent"
        />
        {onAskAgent && (
          <Pressable
            accessibilityLabel="Ask the agent"
            onPress={onAskAgent}
            style={({ pressed }) => [styles.askBtn, pressed && { opacity: 0.8 }]}
          >
            <IconSparkle size={18} color={colors.accent} />
          </Pressable>
        )}
        <Pressable
          accessibilityLabel="Send"
          disabled={disabled || text.trim().length === 0}
          onPress={() => {
            onSend(text.trim());
            setText('');
          }}
          style={({ pressed }) => [
            styles.sendBtn,
            (disabled || text.trim().length === 0) && styles.sendBtnDisabled,
            pressed && { opacity: 0.85 },
          ]}
        >
          <IconSend size={18} color={colors.textOnPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 72,
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...typography.body, color: colors.primary, fontWeight: '600' },
  main: { flex: 1, gap: 1 },
  sender: { ...typography.bodySmall, color: colors.text, fontWeight: '400' },
  senderUnread: { fontWeight: '700' },
  subject: { ...typography.bodySmall, color: colors.textMuted },
  preview: { ...typography.caption, color: colors.textSubtle },
  time: { ...typography.caption, color: colors.textSubtle },
  threadCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  threadSubject: { ...typography.body, color: colors.text, fontWeight: '600' },
  threadMeta: { ...typography.caption, color: colors.textMuted },
  threadDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  threadBody: { ...typography.bodySmall, color: colors.text, lineHeight: 22 },
  composerWrap: { gap: spacing.sm },
  disabledReason: { ...typography.caption, color: colors.warn, textAlign: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  composerDisabled: { opacity: 0.5 },
  input: {
    flex: 1,
    ...typography.body,
    color: colors.text,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
  },
  askBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.surfaceStrong },
});
