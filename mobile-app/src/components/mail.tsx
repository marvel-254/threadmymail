/**
 * Mail components — ThreadMessage and Composer.
 * Nordic design: clean surfaces, accent-primary actions, ≥48dp touch targets.
 */
import { useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconSend, IconSparkle } from './Icons';

/* ── ThreadMessage ─────────────────────────────────────────────────────── */
export type ThreadMessage = {
  id: string;
  sender: string;
  email: string;
  time: string;
  body: string;
};

export function ThreadMessage({
  msg,
  defaultCollapsed = false,
}: {
  msg: ThreadMessage;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <View style={styles.threadCard}>
      <Text style={styles.threadSubject}>{msg.sender}</Text>
      <Text style={styles.threadMeta}>
        {msg.email} · {msg.time}
      </Text>
      <View style={styles.threadDivider} />
      {collapsed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show this earlier message"
          onPress={() => setCollapsed(false)}
          style={({ pressed }) => [styles.collapseBtn, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.collapseBtnText}>Show earlier message</Text>
        </Pressable>
      ) : (
        <>
          <Text style={styles.threadBody}>{msg.body}</Text>
          {defaultCollapsed && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Collapse this earlier message"
              onPress={() => setCollapsed(true)}
              style={({ pressed }) => [styles.collapseBtn, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.collapseBtnText}>Collapse</Text>
            </Pressable>
          )}
        </>
      )}
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
            <IconSparkle size={18} color={colors.primary} />
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

const styles = themedStyles(() => ({
  threadCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  threadSubject: { ...typography.body, color: colors.text, fontWeight: '600' },
  threadMeta: { ...typography.caption, color: colors.textMuted },
  threadDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  threadBody: { ...typography.bodySmall, color: colors.text, lineHeight: 22 },
  collapseBtn: {
    minHeight: touch.minTarget,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
  },
  collapseBtnText: { ...typography.caption, color: colors.primaryText, fontWeight: '600' },
  composerWrap: { gap: spacing.sm },
  disabledReason: { ...typography.caption, color: colors.warnText, textAlign: 'center' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
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
  sendBtnDisabled: { backgroundColor: colors.bgSurfaceHover },
}));