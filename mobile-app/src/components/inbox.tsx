/**
 * Gmail-style inbox chrome — search field, filter chips, and the thread row.
 *
 * Layout follows Gmail's density: sender and date on the top line, subject
 * inline with a truncated preview on the second, an attachment glyph when one is
 * present, and an unread dot that is a dot *and* a weight change so the state
 * is never carried by colour alone.
 */
import React, { useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { formatListTime, type MailFilter, type Message } from '../lib/mail';
import { IconCheck, IconMail, IconSearch, IconStar, IconTrash, IconX } from './Icons';

/* ── Search field ──────────────────────────────────────────────────────── */
type SearchBarProps = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChangeText, placeholder = 'Search mail' }: SearchBarProps) {
  return (
    <View style={styles.searchWrap}>
      <View style={styles.search}>
        <IconSearch size={18} color={colors.textSubtle} />
        <TextInput
          style={styles.searchInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textSubtle}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Search mail"
          returnKeyType="search"
        />
        {value.length > 0 && (
          <Pressable
            accessibilityLabel="Clear search"
            onPress={() => onChangeText('')}
            style={({ pressed }) => [styles.searchClear, pressed && { opacity: 0.7 }]}
          >
            <IconX size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

/* ── Filter chips ──────────────────────────────────────────────────────── */
const FILTERS: { id: MailFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'needs_reply', label: 'Needs reply' },
  { id: 'starred', label: 'Starred' },
];

type FilterChipsProps = {
  value: MailFilter;
  onChange: (f: MailFilter) => void;
  counts: Record<MailFilter, number>;
};

export function FilterChips({ value, onChange, counts }: FilterChipsProps) {
  return (
    <View style={styles.chipRow}>
      {FILTERS.map((f) => {
        const active = f.id === value;
        return (
          <Pressable
            key={f.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${f.label}, ${counts[f.id]} messages`}
            onPress={() => onChange(f.id)}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.85 }]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {f.label}
              {counts[f.id] > 0 ? ` ${counts[f.id]}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Thread row ────────────────────────────────────────────────────────── */
const ACTION_WIDTH = 148;
const SWIPE_TRIGGER = 64;

type ThreadRowProps = {
  message: Message;
  onPress: (id: string) => void;
  onToggleStar: (id: string) => void;
  onToggleRead: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onShowActions: (message: Message) => void;
};

export function ThreadRow({
  message,
  onPress,
  onToggleStar,
  onToggleRead,
  onArchive,
  onDelete,
  onShowActions,
}: ThreadRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opened = useRef(false);
  const longPressed = useRef(false);
  const latest = useRef({
    message,
    onPress,
    onToggleRead,
    onArchive,
    onDelete,
    onShowActions,
  });
  latest.current = { message, onPress, onToggleRead, onArchive, onDelete, onShowActions };

  const snap = (toOpen: boolean) => {
    opened.current = toOpen;
    Animated.spring(translateX, {
      toValue: toOpen ? -ACTION_WIDTH : 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, gesture) =>
        Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
      onPanResponderMove: (_, gesture) => {
        const base = opened.current ? -ACTION_WIDTH : 0;
        const next = Math.max(-ACTION_WIDTH - 24, Math.min(80, base + gesture.dx));
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const base = opened.current ? -ACTION_WIDTH : 0;
        const target = base + gesture.dx;
        if (!opened.current && gesture.dx > SWIPE_TRIGGER) {
          snap(false);
          latest.current.onToggleRead(latest.current.message.id);
          return;
        }
        if (target < -ACTION_WIDTH * 0.3 || (gesture.vx < -0.45 && gesture.dx < 0)) {
          snap(true);
        } else {
          snap(false);
        }
      },
      onPanResponderTerminate: () => snap(opened.current),
    }),
  ).current;

  const handlePress = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    if (opened.current) {
      snap(false);
      return;
    }
    onPress(message.id);
  };

  const handleLongPress = () => {
    longPressed.current = true;
    setTimeout(() => {
      longPressed.current = false;
    }, 400);
    onShowActions(message);
  };

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Archive message"
          onPress={() => {
            snap(false);
            onArchive(message.id);
          }}
          style={({ pressed }) => [styles.swipeAction, styles.archiveAction, pressed && { opacity: 0.8 }]}
        >
          <IconMail size={18} color={colors.textOnPrimary} />
          <Text style={styles.swipeActionText}>Archive</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete message"
          onPress={() => {
            snap(false);
            onDelete(message.id);
          }}
          style={({ pressed }) => [styles.swipeAction, styles.deleteAction, pressed && { opacity: 0.8 }]}
        >
          <IconTrash size={18} color={colors.textOnPrimary} />
          <Text style={styles.swipeActionText}>Delete</Text>
        </Pressable>
      </View>

      <Animated.View
        style={{ transform: [{ translateX }] }}
        {...pan.panHandlers}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${message.from}, ${message.subject}, ${formatListTime(message.date)}`}
          accessibilityHint="Swipe right to toggle read, swipe left for archive and delete, or long-press for actions."
          accessibilityActions={[
            { name: 'toggle_read', label: message.unread ? 'Mark read' : 'Mark unread' },
            { name: 'archive', label: 'Archive' },
            { name: 'delete', label: 'Delete' },
          ]}
          onAccessibilityAction={(event) => {
            switch (event.nativeEvent.actionName) {
              case 'toggle_read':
                onToggleRead(message.id);
                break;
              case 'archive':
                onArchive(message.id);
                break;
              case 'delete':
                onDelete(message.id);
                break;
              default:
                break;
            }
          }}
          onPress={handlePress}
          onLongPress={handleLongPress}
          delayLongPress={450}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        >
          {/* Unread marker: a dot plus bold weight, never colour alone. */}
          <View style={styles.rowGutter}>
            {message.unread ? <View style={styles.unreadDot} /> : null}
          </View>

          <View style={styles.rowMain}>
            <View style={styles.rowTop}>
              <Text
                style={[styles.sender, message.unread && styles.senderUnread]}
                numberOfLines={1}
              >
                {message.from}
              </Text>
              <Text style={styles.rowDate}>{formatListTime(message.date)}</Text>
            </View>

            <View style={styles.rowBottom}>
              <Text
                style={[styles.subject, message.unread && styles.subjectUnread]}
                numberOfLines={1}
              >
                {message.subject}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {message.preview}
              </Text>
            </View>
          </View>

          {message.needsReply && (
            <View style={styles.needsReply}>
              <Text style={styles.needsReplyText}>Reply</Text>
            </View>
          )}

          <Pressable
            accessibilityLabel={message.starred ? 'Unstar' : 'Star'}
            onPress={() => onToggleStar(message.id)}
            style={({ pressed }) => [styles.starBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <IconStar size={18} color={message.starred ? colors.warn : colors.textSubtle} filled={message.starred} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/* ── Long-press action sheet ───────────────────────────────────────────── */
type MailActionSheetProps = {
  message: Message | null;
  onClose: () => void;
  onToggleRead: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
};

export function MailActionSheet({
  message,
  onClose,
  onToggleRead,
  onArchive,
  onDelete,
}: MailActionSheetProps) {
  if (!message) return null;
  const run = (action: (id: string) => void) => {
    action(message.id);
    onClose();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} accessibilityLabel="Close actions">
        <View
          style={styles.sheet}
          onStartShouldSetResponder={() => true}
          accessibilityViewIsModal
        >
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetSubject} numberOfLines={1}>{message.subject}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => run(onToggleRead)}
            style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
          >
            <IconCheck size={18} color={colors.text} />
            <Text style={styles.sheetItemText}>{message.unread ? 'Mark read' : 'Mark unread'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => run(onArchive)}
            style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
          >
            <IconMail size={18} color={colors.text} />
            <Text style={styles.sheetItemText}>Archive</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => run(onDelete)}
            style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
          >
            <IconTrash size={18} color={colors.danger} />
            <Text style={[styles.sheetItemText, styles.sheetItemDanger]}>Delete</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.sheetCancel, pressed && styles.sheetItemPressed]}
          >
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

/* ── Sync banner ───────────────────────────────────────────────────────── */
type SyncBannerProps = {
  phase: 'idle' | 'importing' | 'idle-watching' | 'offline' | 'error';
  progress: number;
  imported: number;
  cappedAt: number | null;
  error: string | null;
};

export function SyncBanner({ phase, progress, imported, cappedAt, error }: SyncBannerProps) {
  if (phase === 'idle' && !cappedAt && !error) return null;

  if (phase === 'importing') {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Importing history… {Math.round(progress * 100)}% · {imported} messages
        </Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[styles.banner, styles.bannerError]}>
        <Text style={styles.bannerText}>{error ?? 'Sync failed'}</Text>
      </View>
    );
  }

  if (phase === 'offline') {
    return (
      <View style={styles.banner}>
        <Text style={styles.bannerText}>Offline — showing what was last synced.</Text>
      </View>
    );
  }

  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>
        {cappedAt
          ? `Showing the most recent ${cappedAt.toLocaleString()} messages. Older mail is fetched when you open it.`
          : 'Watching for new mail.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    minHeight: touch.minTarget,
  },
  searchInput: {
    flex: 1,
    ...typography.bodySmall,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  searchClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextActive: { color: colors.textOnPrimary, fontWeight: '600' },

  swipeWrap: { overflow: 'hidden', backgroundColor: colors.bg },
  swipeActions: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  swipeAction: {
    width: ACTION_WIDTH / 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  archiveAction: { backgroundColor: colors.primary },
  deleteAction: { backgroundColor: colors.danger },
  swipeActionText: { ...typography.caption, color: colors.textOnPrimary, fontWeight: '700' },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 72,
    backgroundColor: colors.bg,
  },
  rowPressed: { backgroundColor: colors.surfaceHover },
  rowGutter: { width: 10, alignItems: 'center', paddingTop: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  rowMain: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sender: { flex: 1, ...typography.bodySmall, color: colors.textMuted, fontWeight: '400' },
  senderUnread: { color: colors.text, fontWeight: '700' },
  rowDate: { ...typography.caption, color: colors.textSubtle },
  rowBottom: { flexDirection: 'row', gap: spacing.sm },
  subject: { ...typography.bodySmall, color: colors.textMuted, maxWidth: '55%' },
  subjectUnread: { color: colors.text, fontWeight: '600' },
  preview: { flex: 1, ...typography.caption, color: colors.textSubtle },

  needsReply: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.accentBg,
    alignSelf: 'center',
  },
  needsReplyText: { ...typography.label, fontSize: 9, color: colors.accent },

  starBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surfaceStrong,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    gap: spacing.xs,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginBottom: spacing.sm,
  },
  sheetSubject: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
  },
  sheetItemPressed: { backgroundColor: colors.surfaceHover },
  sheetItemText: { ...typography.body, color: colors.text },
  sheetItemDanger: { color: colors.danger },
  sheetCancel: {
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sheetCancelText: { ...typography.bodySmall, color: colors.textMuted, fontWeight: '600' },

  banner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  bannerError: { borderColor: colors.danger },
  bannerText: { ...typography.caption, color: colors.textMuted },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceStrong,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: colors.primary },
});
