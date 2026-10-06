/**
 * Shared UI primitives — Button, Card, SectionLabel, EmptyState, ConfirmDialog, Toast.
 * All token-referenced (theme.ts), ≥48dp touch targets, 8px gaps.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconCheck, IconX } from './Icons';

/* ── Button ─────────────────────────────────────────────────────────────── */
type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'accent' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  icon,
}: ButtonProps) {
  const bg = {
    primary: colors.primary,
    secondary: colors.surfaceStrong,
    accent: colors.accent,
    danger: colors.danger,
    ghost: 'transparent',
  }[variant];
  const fg = {
    primary: colors.textOnPrimary,
    secondary: colors.text,
    accent: colors.textOnAccent,
    danger: colors.textOnPrimary,
    ghost: colors.text,
  }[variant];
  const border = variant === 'secondary' || variant === 'ghost' ? colors.border : 'transparent';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, borderColor: border },
        fullWidth && styles.btnFull,
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && { opacity: 0.85 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon}
          <Text style={[styles.btnText, { color: fg }]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    borderWidth: 1,
  },
  btnFull: { width: '100%' },
  btnDisabled: { opacity: 0.4 },
  btnText: { fontSize: 16, fontWeight: '600' },
});

/* ── Card ───────────────────────────────────────────────────────────────── */
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles2.card, style]}>{children}</View>;
}

const styles2 = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
});
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles3.label}>{children}</Text>;
}

const styles3 = StyleSheet.create({
  label: {
    ...typography.label,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
});

/* ── EmptyState ─────────────────────────────────────────────────────────── */
type EmptyStateProps = {
  icon?: React.ReactNode;
  title: string;
  body?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon, title, body, action }: EmptyStateProps) {
  return (
    <View style={styles4.container}>
      {icon}
      <Text style={styles4.title}>{title}</Text>
      {body ? <Text style={styles4.body}>{body}</Text> : null}
      {action}
    </View>
  );
}

const styles4 = StyleSheet.create({
  container: { alignItems: 'center', padding: spacing.xxl, gap: spacing.md },
  title: { ...typography.h3, color: colors.text, textAlign: 'center' },
  body: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
});

/* ── ConfirmDialog ─────────────────────────────────────────────────────── */
type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
      <View style={styles5.backdrop}>
        <View style={styles5.card} accessibilityViewIsModal>
          <Text style={styles5.title}>{title}</Text>
          {body ? <Text style={styles5.body}>{body}</Text> : null}
          <View style={styles5.actions}>
            <Button label={cancelLabel} variant="ghost" onPress={onCancel} />
            <Button
              label={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={onConfirm}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles5 = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
    width: '100%',
    maxWidth: 360,
  },
  title: { ...typography.h3, color: colors.text },
  body: { ...typography.bodySmall, color: colors.textMuted },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
});

/* ── Toast ─────────────────────────────────────────────────────────────── */
type ToastProps = {
  visible: boolean;
  message: string;
  ok?: boolean;
};

export function Toast({ visible, message, ok = true }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2000),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity]);

  if (!visible) return null;
  return (
    <Animated.View style={[styles6.toast, { opacity }]} pointerEvents="none">
      {ok ? <IconCheck size={16} color={colors.success} /> : <IconX size={16} color={colors.danger} />}
      <Text style={styles6.text}>{message}</Text>
    </Animated.View>
  );
}

const styles6 = StyleSheet.create({
  toast: {
    position: 'absolute',
    top: 8,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    zIndex: 100,
  },
  text: { ...typography.bodySmall, color: colors.text, flex: 1 },
});
