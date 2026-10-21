/**
 * Draft queue card — shared by Today and the thread view.
 *
 * Send is explicitly disabled in shadow mode; the draft is still visible so the
 * user can edit or discard it, but nothing leaves the device.
 */
import {
  Pressable,
  Text,
  View,
} from 'react-native';
import type { Draft } from '../lib/agent/draftStore';
import { themedStyles, colors, radii, spacing, typography } from '../theme/theme';

type DraftCardProps = {
  draft: Draft;
  shadow: boolean;
  busy?: boolean;
  onSend: () => void;
  onEdit: () => void;
  onDiscard: () => void;
};

export function DraftCard({ draft, shadow, busy = false, onSend, onEdit, onDiscard }: DraftCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.label}>Draft ready</Text>
        <Text style={styles.to} numberOfLines={1}>{draft.to}</Text>
      </View>
      <Text style={styles.subject} numberOfLines={1}>{draft.subject}</Text>
      <Text style={styles.body} numberOfLines={3}>{draft.body}</Text>
      {shadow && (
        <Text style={styles.shadowNote}>Shadow mode: sending is disabled until you turn it off.</Text>
      )}
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Send draft to ${draft.to}`}
          disabled={shadow || busy}
          onPress={onSend}
          style={({ pressed }) => [
            styles.action,
            styles.send,
            (shadow || busy) && styles.disabled,
            pressed && !shadow && !busy && styles.pressed,
          ]}
        >
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Edit draft"
          disabled={busy}
          onPress={onEdit}
          style={({ pressed }) => [styles.action, pressed && !busy && styles.pressed]}
        >
          <Text style={styles.actionText}>Edit</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard draft"
          disabled={busy}
          onPress={onDiscard}
          style={({ pressed }) => [styles.action, pressed && !busy && styles.pressed]}
        >
          <Text style={[styles.actionText, styles.discard]}>Discard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { ...typography.label, color: colors.accent, flex: 1 },
  to: { ...typography.caption, color: colors.textMuted, flexShrink: 1 },
  subject: { ...typography.body, color: colors.text, fontWeight: '600' },
  body: { ...typography.caption, color: colors.textMuted },
  shadowNote: { ...typography.caption, color: colors.warnText },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  action: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  send: { backgroundColor: colors.primary, borderColor: colors.primary },
  sendText: { ...typography.bodySmall, color: colors.textOnPrimary, fontWeight: '600' },
  actionText: { ...typography.bodySmall, color: colors.text },
  discard: { color: colors.dangerText },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
}));
