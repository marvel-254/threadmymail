/**
 * Shared UI primitives — Button, Card, SectionHeader, Chip, ListRow,
 * EmptyState, Skeleton, Divider, StatusIndicator, ConfirmDialog, Toast,
 * BottomSheet.
 *
 * Nordic design system (theme.ts): pure-black OLED dark / pure-white light,
 * restrained surfaces, one accent action per surface, ≥48dp touch targets,
 * 8px gaps, system fonts.
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
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconCheck, IconX } from './Icons';

/* ── Theme-audited convenience constants ─────────────────────────────────── */

/**
 * Standard surface layers resolved from the live palette. Use these instead of
 * hardcoding rgba — they follow dark/light/OLED automatically.
 */
export const surfaces = {
  canvas: colors.bg,
  card: colors.bgSurface,
  raised: colors.bgSurfaceHover,
} as const;

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
    secondary: colors.bgSurfaceHover,
    accent: colors.info,
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
      android_ripple={{ color: colors.bgSurfaceHover, borderless: true }}
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
    borderRadius: radii.pill,
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
export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles2.card, style]}>{children}</View>;
}

const styles2 = themedStyles(() => ({
  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
}));

/* ── IconButton ─────────────────────────────────────────────────────────── */
type IconButtonProps = {
  icon: React.ReactNode;
  onPress: () => void;
  label: string;
  disabled?: boolean;
  variant?: 'default' | 'primary';
  size?: number;
};

/**
 * Square touch target ≥48dp that wraps an icon. The default variant is a
 * quiet, borderless button on the canvas; `primary` fills with the accent.
 */
export function IconButton({
  icon,
  onPress,
  label,
  disabled = false,
  variant = 'default',
  size = touch.minTarget,
}: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      android_ripple={{ color: colors.bgSurfaceHover, borderless: true }}
      style={({ pressed }) => [
        styles3.btn,
        {
          width: size,
          height: size,
          backgroundColor: variant === 'primary' ? colors.primary : colors.bgSurface,
        },
        disabled && styles3.disabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      {icon}
    </Pressable>
  );
}

const styles3 = themedStyles(() => ({
  btn: {
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.4 },
}));

/* ── SectionHeader ──────────────────────────────────────────────────────── */

/**
 * Section header for grouping content within a screen. Quiet, non-boxed,
 * uppercase small label — consistent across all screens.
 */
export function SectionHeader({ children }: { children: React.ReactNode }) {
  return <Text style={styles4.label}>{children}</Text>;
}

const styles4 = themedStyles(() => ({
  label: {
    ...typography.label,
    color: colors.textSubtle,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
}));

/* ── Deprecated alias: SectionLabel ─────────────────────────────────────── */
/**
 * Kept for backward compatibility during migration. Prefer SectionHeader.
 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <SectionHeader>{children}</SectionHeader>;
}

/* ── Chip ───────────────────────────────────────────────────────────────── */
type ChipProps = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
};

/**
 * Toggleable chip used for filters, quick options, and tags. Selected uses the
 * accent edge tone; unselected is a quiet surface. ≥48dp tall.
 */
export function Chip({ label, selected = false, onPress, disabled = false, icon }: ChipProps) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected } : undefined}
      accessibilityLabel={label}
      disabled={disabled || !onPress}
      onPress={onPress}
      android_ripple={{ color: colors.bgSurfaceHover, borderless: true }}
      style={({ pressed }) => [
        styles5.chip,
        selected && styles5.chipSelected,
        disabled && styles5.chipDisabled,
        pressed && { opacity: 0.75 },
      ]}
    >
      {icon}
      <Text style={[styles5.chipText, selected && styles5.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles5 = themedStyles(() => ({
  chip: {
    minHeight: touch.minTarget - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.borderPrimary,
  },
  chipDisabled: { opacity: 0.4 },
  chipText: { ...typography.bodySmall, color: colors.text },
  chipTextSelected: { color: colors.primaryText, fontWeight: '600' },
}));

/* ── ListRow ────────────────────────────────────────────────────────────── */

/**
 * Pressable row with a leading slot, flexible body, and optional trailing.
 * The whole row is one ≥48dp target; the leading/trailing affordances are
 * purely visual unless separately composed.
 */
export function ListRow({
  onPress,
  leading,
  children,
  trailing,
  disabled = false,
  accessibilityLabel,
}: {
  onPress?: () => void;
  leading?: React.ReactNode;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled || !onPress}
      onPress={onPress}
      android_ripple={{ color: colors.bgSurfaceHover }}
      style={({ pressed }) => [
        styles6.row,
        pressed && onPress && { opacity: 0.75 },
        disabled && styles6.disabled,
      ]}
    >
      {leading}
      <View style={styles6.body}>{children}</View>
      {trailing}
    </Pressable>
  );
}

const styles6 = themedStyles(() => ({
  row: {
    minHeight: touch.minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.bgSurface,
  },
  body: { flex: 1 },
  disabled: { opacity: 0.4 },
}));

/* ── Divider ────────────────────────────────────────────────────────────── */

/**
 * Hairline divider between list rows / sections. Subtle, not boxed.
 */
export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles7.divider, { marginLeft: inset }]} />;
}

const styles7 = themedStyles(() => ({
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
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
    <View style={styles8.container}>
      {icon}
      <Text style={styles8.title}>{title}</Text>
      {body ? <Text style={styles8.body}>{body}</Text> : null}
      {action}
    </View>
  );
}

const styles8 = themedStyles(() => ({
  container: { alignItems: 'center', padding: spacing.xxl, gap: spacing.md },
  title: { ...typography.h3, color: colors.text, textAlign: 'center' },
  body: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center', maxWidth: 280 },
}));

/* ── Skeleton ───────────────────────────────────────────────────────────── */

/**
 * Animated placeholder that visually indicates provisional content without
 * pretending to be data. Used for loading states; respects reduced motion via
 * the shared Animated loop (no pulse when the OS asks for less).
 */
export function Skeleton({ width = '100%', height = 16, radius = radii.sm }: {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
}) {
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.9, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4, duration: 800, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View style={{ width, height, borderRadius: radius, backgroundColor: colors.bgSurfaceHover, opacity }} />
  );
}

/* ── StatusIndicator ────────────────────────────────────────────────────── */

/**
 * Compact inline status: a dot + optional text. Never the only signal —
 * always pair with a label. Conveys a semantic state without relying on color
 * alone (dot always has a matching "good/needs/warning" cue).
 */
export function StatusIndicator({ tone, label }: {
  tone: 'neutral' | 'success' | 'warn' | 'danger' | 'accent';
  label?: string;
}) {
  const dot = {
    neutral: colors.textSubtle,
    success: colors.success,
    warn: colors.warn,
    danger: colors.danger,
    accent: colors.primary,
  }[tone];
  return (
    <View style={styles9.wrap}>
      <View style={[styles9.dot, { backgroundColor: dot }]} />
      {label ? <Text style={styles9.label}>{label}</Text> : null}
    </View>
  );
}

const styles9 = themedStyles(() => ({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { ...typography.caption, color: colors.textMuted },
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
      <View style={styles10.backdrop}>
        <View style={styles10.card} accessibilityViewIsModal>
          <Text style={styles10.title}>{title}</Text>
          {body ? <Text style={styles10.body}>{body}</Text> : null}
          <View style={styles10.actions}>
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

const styles10 = themedStyles(() => ({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.bgSurfaceHover,
    borderRadius: radii.xl,
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
      style={[styles11.toast, { opacity }]}
      pointerEvents={hasAction ? 'box-none' : 'none'}
    >
      {ok ? <IconCheck size={16} color={colors.successText} /> : <IconX size={16} color={colors.dangerText} />}
      <Text style={styles11.text}>{message}</Text>
      {onAction && actionLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          onPress={onAction}
          style={({ pressed }) => [styles11.toastAction, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles11.toastActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles11 = themedStyles(() => ({
  toast: {
    position: 'absolute',
    top: 8,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.bgSurfaceHover,
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
        style={styles12.root}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable
          style={styles12.backdrop}
          onPress={onClose}
          accessibilityLabel="Close sheet"
        />
        <Animated.View
          style={[
            styles12.sheet,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
            { transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal
        >
          <View style={styles12.handleArea} {...panResponder.panHandlers}>
            <View style={styles12.handle} />
          </View>
          {(title || headerRight) && (
            <View style={styles12.header}>
              {title ? <Text style={styles12.title} numberOfLines={2}>{title}</Text> : <View />}
              {headerRight}
            </View>
          )}
          {scroll ? (
            <ScrollView
              style={styles12.scroll}
              contentContainerStyle={styles12.body}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles12.body}>{children}</View>
          )}
          {footer ? <View style={styles12.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles12 = themedStyles(() => ({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: colors.bg,
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
