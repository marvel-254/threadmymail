/**
 * Shared UI primitives — Button, Card, SectionLabel, EmptyState, ConfirmDialog, Toast.
 * All token-referenced (theme.ts), ≥48dp touch targets, 8px gaps.
 */
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
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

const styles = themedStyles(() => ({
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
}));

/* ── Card ───────────────────────────────────────────────────────────────── */
export function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles2.card, style]}>{children}</View>;
}

const styles2 = themedStyles(() => ({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
}));
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles3.label}>{children}</Text>;
}

const styles3 = themedStyles(() => ({
  label: {
    ...typography.label,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
}));

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

const styles4 = themedStyles(() => ({
  container: { alignItems: 'center', padding: spacing.xxl, gap: spacing.md },
  title: { ...typography.h3, color: colors.text, textAlign: 'center' },
  body: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
}));

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

const styles5 = themedStyles(() => ({
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
}));

/* ── Toast ─────────────────────────────────────────────────────────────── */
type ToastProps = {
  visible: boolean;
  message: string;
  ok?: boolean;
  actionLabel?: string;
  onAction?: () => void;
};

export function Toast({
  visible,
  message,
  ok = true,
  actionLabel,
  onAction,
}: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const hasAction = !!onAction;

  useEffect(() => {
    if (visible) {
      opacity.stopAnimation();
      opacity.setValue(0);
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(hasAction ? 5000 : 2000),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible, opacity, hasAction, message]);

  if (!visible) return null;
  return (
    <Animated.View
      style={[styles6.toast, { opacity }]}
      pointerEvents={hasAction ? 'box-none' : 'none'}
    >
      {ok ? <IconCheck size={16} color={colors.successText} /> : <IconX size={16} color={colors.dangerText} />}
      <Text style={styles6.text}>{message}</Text>
      {onAction && actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles6.toastAction, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles6.toastActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles6 = themedStyles(() => ({
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
  toastAction: {
    minHeight: touch.minTarget,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  toastActionText: { ...typography.bodySmall, color: colors.primaryText, fontWeight: '700' },
}));


/* ── BottomSheet ────────────────────────────────────────────────────────── */
type BottomSheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  /** Wrap the body in a ScrollView (default true). */
  scroll?: boolean;
  children: React.ReactNode;
};

/**
 * Shared bottom sheet: scrim, back-button close, drag-down dismiss, and a
 * keyboard-aware scroll body with a pinned footer. Use this for every sheet so
 * long forms stay reachable while the keyboard is open.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  headerRight,
  footer,
  scroll = true,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 4,
      onPanResponderMove: (_, gesture) => {
        translateY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 90 || gesture.vy > 0.6) {
          closeRef.current();
          return;
        }
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 0,
        }).start();
      },
    }),
  ).current;

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [visible, translateY]);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles7.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={styles7.backdrop}
          onPress={onClose}
          accessibilityLabel="Close sheet"
        />
        <Animated.View
          style={[
            styles7.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            { transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles7.handleArea} {...panResponder.panHandlers}>
            <View style={styles7.handle} />
          </View>
          {(title || headerRight) && (
            <View style={styles7.header}>
              {title ? <Text style={styles7.title} numberOfLines={2}>{title}</Text> : <View />}
              {headerRight}
            </View>
          )}
          {scroll ? (
            <ScrollView
              style={styles7.scroll}
              contentContainerStyle={styles7.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles7.body}>{children}</View>
          )}
          {footer ? <View style={styles7.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles7 = themedStyles(() => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.bgDeep,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  handleArea: {
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: spacing.sm,
  },
  title: { ...typography.h3, color: colors.text, flex: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: spacing.md, paddingBottom: spacing.sm },
  footer: {
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
}));
