/**
 * Gmail-style inbox chrome — search field, filter chips, and the thread row.
 *
 * Layout follows Gmail's density: sender and date on the top line, subject
 * inline with a truncated preview on the second, an attachment glyph when one is
 * present, and an unread dot that is a dot *and* a weight change so the state
 * is never carried by colour alone.
 */
import { useRef } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BottomSheet } from './ui';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
import { formatListTime, type MailFilter, type Thread } from '../lib/mail';
import { IconCheck, IconMail, IconSearch, IconStar, IconTrash, IconX } from './Icons';

/* ── Search field ──────────────────────────────────────────────────────── */
type SearchBarProps = {
  value: string;
  onChangeText: (v: string) => void;
  onSubmitEditing?: (v: string) => void;
  placeholder?: string;
};

export function SearchBar({ value, onChangeText, onSubmitEditing, placeholder = 'Search mail' }: SearchBarProps) {
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
          onSubmitEditing={() => onSubmitEditing?.(value)}
        />
        {value.length > 0 && (
          <Pressable
            accessibilityLabel="Clear search"
            hitSlop={8}
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
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
      contentContainerStyle={styles.chipRow}
    >
      {FILTERS.map((f) => {
        const active = f.id === value;
        return (
          <Pressable
            key={f.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${f.label}, ${counts[f.id]} conversations`}
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
    </ScrollView>
  );
}

/* ── Account switcher ──────────────────────────────────────────────────── */
type AccountOption = { id: string; email: string; primary: boolean };

type AccountChipsProps = {
  accounts: AccountOption[];
  value: string;
  onChange: (accountId: string) => void;
  unreadCounts: Record<string, number>;
};

export function AccountChips({ accounts, value, onChange, unreadCounts }: AccountChipsProps) {
  if (accounts.length === 0) return null;
  const totalUnread = accounts.reduce(
    (sum, account) => sum + (unreadCounts[account.id] ?? 0),
    0,
  );
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.accountScroll}
      contentContainerStyle={styles.accountRow}
    >
      {accounts.length > 1 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: value === 'all' }}
          onPress={() => onChange('all')}
          style={[styles.accountChip, value === 'all' && styles.accountChipActive]}
        >
          <Text style={[styles.accountChipText, value === 'all' && styles.accountChipTextActive]}>
            All accounts{totalUnread > 0 ? ` ${totalUnread}` : ''}
          </Text>
        </Pressable>
      )}
      {accounts.map((account) => {
        const active = value === account.id || (accounts.length === 1 && value === 'all');
        const unread = unreadCounts[account.id] ?? 0;
        return (
          <Pressable
            key={account.id}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${account.email}${unread > 0 ? `, ${unread} unread` : ''}`}
            onPress={() => onChange(account.id)}
            style={[styles.accountChip, active && styles.accountChipActive]}
          >
            {account.primary && <View style={styles.accountDot} />}
            <Text
              style={[styles.accountChipText, active && styles.accountChipTextActive]}
              numberOfLines={1}
            >
              {account.email}
              {unread > 0 ? ` ${unread}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/* ── Folder sheet ──────────────────────────────────────────────────────── */
export type FolderOption = {
  path: string;
  name: string;
  flags: string[];
  exists?: number;
  unseen?: number;
};

type FolderSheetProps = {
  visible: boolean;
  accounts: { id: string; email: string }[];
  folders: Record<string, FolderOption[]>;
  errors?: Record<string, string>;
  loading: boolean;
  currentAccountId: string;
  currentPath: string;
  onSelect: (accountId: string, folder: FolderOption) => void;
  onClose: () => void;
};

function folderRank(folder: FolderOption): number {
  const flags = folder.flags.map((flag) => flag.toLowerCase());
  if (folder.path === 'INBOX' || flags.includes('\\inbox')) return 0;
  if (flags.includes('\\sent')) return 1;
  if (flags.includes('\\archive') || flags.includes('\\all')) return 2;
  if (flags.includes('\\drafts')) return 3;
  if (flags.includes('\\trash')) return 4;
  if (flags.includes('\\junk') || flags.includes('\\spam')) return 5;
  return 6;
}

export function FolderSheet({
  visible,
  accounts,
  folders,
  errors,
  loading,
  currentAccountId,
  currentPath,
  onSelect,
  onClose,
}: FolderSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Folders" scroll>
      {loading && (
        <Text style={styles.folderHint}>Loading folders…</Text>
      )}
      {!loading && accounts.length === 0 && (
        <Text style={styles.folderHint}>Connect an account to browse folders.</Text>
      )}
      {accounts.map((account) => {
        const list = [...(folders[account.id] ?? [])].sort((a, b) => (
          folderRank(a) - folderRank(b) || a.name.localeCompare(b.name)
        ));
        const error = errors?.[account.id];
        return (
          <View key={account.id} style={styles.folderGroup}>
            {accounts.length > 1 && (
              <Text style={styles.folderAccount} numberOfLines={1}>{account.email}</Text>
            )}
            {error && <Text style={styles.folderError}>{error}</Text>}
            {!error && !loading && list.length === 0 && (
              <Text style={styles.folderHint}>No selectable folders.</Text>
            )}
            {list.map((folder) => {
              const current = account.id === currentAccountId && folder.path === currentPath;
              const unseen = folder.unseen ?? 0;
              return (
                <Pressable
                  key={`${account.id}:${folder.path}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: current }}
                  accessibilityLabel={`${folder.name}${unseen > 0 ? `, ${unseen} unread` : ''}`}
                  onPress={() => onSelect(account.id, folder)}
                  style={({ pressed }) => [
                    styles.folderRow,
                    current && styles.folderRowActive,
                    pressed && styles.sheetItemPressed,
                  ]}
                >
                  <Text
                    style={[styles.folderName, current && styles.folderNameActive]}
                    numberOfLines={1}
                  >
                    {folder.name}
                  </Text>
                  {unseen > 0 && (
                    <Text style={styles.folderCount}>{unseen}</Text>
                  )}
                  {current && <IconCheck size={16} color={colors.primaryText} />}
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </BottomSheet>
  );
}

/* ── Recent searches ───────────────────────────────────────────────────── */
type RecentSearchesProps = {
  items: string[];
  onSelect: (query: string) => void;
  onClear: () => void;
};

export function RecentSearches({ items, onSelect, onClear }: RecentSearchesProps) {
  if (items.length === 0) return null;
  return (
    <View style={styles.recentRow}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.recentScroll}
        contentContainerStyle={styles.recentList}
      >
        <Text style={styles.recentLabel}>Recent</Text>
        {items.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityLabel={`Search for ${item}`}
            onPress={() => onSelect(item)}
            style={({ pressed }) => [styles.recentChip, pressed && { opacity: 0.75 }]}
          >
            <Text style={styles.recentChipText} numberOfLines={1}>{item}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear recent searches"
        hitSlop={8}
        onPress={onClear}
        style={({ pressed }) => [styles.recentClear, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.recentClearText}>Clear</Text>
      </Pressable>
    </View>
  );
}

/* ── Thread row ────────────────────────────────────────────────────────── */
const ACTION_WIDTH = 148;
const SWIPE_TRIGGER = 64;

type ThreadRowProps = {
  thread: Thread;
  accountLabel?: string;
  onPress: (threadId: string) => void;
  onToggleStar: (threadId: string) => void;
  onToggleRead: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onDelete: (threadId: string) => void;
  onShowActions: (thread: Thread) => void;
};

function participantLabel(participants: string[]): string {
  if (participants.length === 0) return 'Unknown sender';
  if (participants.length <= 2) return participants.join(', ');
  return `${participants.slice(0, 2).join(', ')} +${participants.length - 2}`;
}

export function ThreadRow({
  thread,
  onPress,
  onToggleStar,
  onToggleRead,
  onArchive,
  onDelete,
  onShowActions,
  accountLabel,
}: ThreadRowProps) {
  const translateX = useRef(new Animated.Value(0)).current;
  const opened = useRef(false);
  const longPressed = useRef(false);
  const message = thread.latest;
  const unread = thread.unreadCount > 0;
  const latest = useRef({
    thread,
    onPress,
    onToggleRead,
    onArchive,
    onDelete,
    onShowActions,
  });
  latest.current = { thread, onPress, onToggleRead, onArchive, onDelete, onShowActions };

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
          latest.current.onToggleRead(latest.current.thread.id);
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
    onPress(thread.id);
  };

  const handleLongPress = () => {
    longPressed.current = true;
    setTimeout(() => {
      longPressed.current = false;
    }, 400);
    onShowActions(thread);
  };

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Archive conversation"
          onPress={() => {
            snap(false);
            onArchive(thread.id);
          }}
          style={({ pressed }) => [styles.swipeAction, styles.archiveAction, pressed && { opacity: 0.8 }]}
        >
          <IconMail size={18} color={colors.textOnPrimary} />
          <Text style={styles.swipeActionText}>Archive</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete conversation"
          onPress={() => {
            snap(false);
            onDelete(thread.id);
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
          accessibilityLabel={`${participantLabel(thread.participants)}, ${thread.subject}, ${thread.messageCount} messages, ${formatListTime(thread.lastDate)}`}
          accessibilityHint="Swipe right to toggle read, swipe left for archive and delete, or long-press for actions."
          accessibilityActions={[
            { name: 'toggle_read', label: unread ? 'Mark read' : 'Mark unread' },
            { name: 'archive', label: 'Archive' },
            { name: 'delete', label: 'Delete' },
          ]}
          onAccessibilityAction={(event) => {
            switch (event.nativeEvent.actionName) {
              case 'toggle_read':
                onToggleRead(thread.id);
                break;
              case 'archive':
                onArchive(thread.id);
                break;
              case 'delete':
                onDelete(thread.id);
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
            {unread ? <View style={styles.unreadDot} /> : null}
          </View>

          <View style={styles.rowMain}>
            <View style={styles.rowTop}>
              <Text
                style={[styles.sender, unread && styles.senderUnread]}
                numberOfLines={1}
              >
                {participantLabel(thread.participants)}
              </Text>
              {accountLabel ? (
                <Text style={styles.accountTag} numberOfLines={1}>{accountLabel}</Text>
              ) : null}
              <Text style={styles.rowDate}>{formatListTime(thread.lastDate)}</Text>
            </View>

            <View style={styles.rowBottom}>
              <Text
                style={[styles.subject, unread && styles.subjectUnread]}
                numberOfLines={1}
              >
                {thread.subject}
              </Text>
              <Text style={styles.preview} numberOfLines={1}>
                {message.preview}
              </Text>
            </View>
          </View>

          {thread.messageCount > 1 && (
            <View style={styles.threadCount}>
              <Text style={styles.threadCountText}>{thread.messageCount}</Text>
            </View>
          )}

          {thread.needsReply && (
            <View style={styles.needsReply}>
              <Text style={styles.needsReplyText}>Reply</Text>
            </View>
          )}

          <Pressable
            accessibilityLabel={thread.starred ? 'Unstar conversation' : 'Star conversation'}
            onPress={() => onToggleStar(thread.id)}
            style={({ pressed }) => [styles.starBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <IconStar size={18} color={thread.starred ? colors.warn : colors.textSubtle} filled={thread.starred} />
          </Pressable>
        </Pressable>
      </Animated.View>
    </View>
  );
}

/* ── Long-press action sheet ───────────────────────────────────────────── */
type MailActionSheetProps = {
  thread: Thread | null;
  onClose: () => void;
  onToggleRead: (threadId: string) => void;
  onArchive: (threadId: string) => void;
  onDelete: (threadId: string) => void;
};

export function MailActionSheet({
  thread,
  onClose,
  onToggleRead,
  onArchive,
  onDelete,
}: MailActionSheetProps) {
  if (!thread) return null;
  const run = (action: (threadId: string) => void) => {
    action(thread.id);
    onClose();
  };
  const anyUnread = thread.unreadCount > 0;

  return (
    <BottomSheet
      visible
      onClose={onClose}
      title={thread.subject}
      scroll={false}
      footer={(
        <Pressable
          accessibilityRole="button"
          onPress={onClose}
          style={({ pressed }) => [styles.sheetCancel, pressed && styles.sheetItemPressed]}
        >
          <Text style={styles.sheetCancelText}>Cancel</Text>
        </Pressable>
      )}
    >
      <Text style={styles.sheetSubject}>
        {thread.messageCount} message{thread.messageCount === 1 ? '' : 's'}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => run(onToggleRead)}
        style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
      >
        <IconCheck size={18} color={colors.text} />
        <Text style={styles.sheetItemText}>{anyUnread ? 'Mark conversation read' : 'Mark conversation unread'}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => run(onArchive)}
        style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
      >
        <IconMail size={18} color={colors.text} />
        <Text style={styles.sheetItemText}>Archive conversation</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => run(onDelete)}
        style={({ pressed }) => [styles.sheetItem, pressed && styles.sheetItemPressed]}
      >
        <IconTrash size={18} color={colors.dangerText} />
        <Text style={[styles.sheetItemText, styles.sheetItemDanger]}>Delete conversation</Text>
      </Pressable>
    </BottomSheet>
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
  if (phase === 'idle-watching' && !cappedAt && !error) return null;
  if (phase === 'offline' && !cappedAt && !error) return null;

  if (phase === 'error' || error) {
    return (
      <View style={[styles.banner, styles.bannerError]}>
        <Text style={[styles.bannerText, { color: colors.dangerText }]}>{error ?? 'Sync error'}</Text>
      </View>
    );
  }

  if (phase === 'importing') {
    return (
      <View style={styles.banner}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.bannerText}>
          {imported > 0 ? `Imported ${imported} messages` : 'Syncing…'}
          {cappedAt ? ` (capped at ${cappedAt})` : ''}
        </Text>
      </View>
    );
  }

  return null;
}

const styles = themedStyles(() => ({
  searchWrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: touch.minTarget,
  },
  searchInput: {
    flex: 1,
    ...typography.body,
    color: colors.text,
  },
  searchClear: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipScroll: { flexGrow: 0, paddingHorizontal: spacing.lg },
  chipRow: { flexDirection: 'row', gap: spacing.xs, paddingVertical: spacing.xs },
  chip: {
    minHeight: touch.minTarget - 8,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.primaryBg,
    borderColor: colors.borderPrimary,
  },
  chipText: { ...typography.bodySmall, color: colors.text },
  chipTextActive: { color: colors.primaryText, fontWeight: '600' },

  accountScroll: { flexGrow: 0 },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  accountChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 220,
    minHeight: 32,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  accountChipActive: { borderColor: colors.primary, backgroundColor: colors.bgSurfaceHover },
  accountChipText: { ...typography.caption, color: colors.textMuted },
  accountChipTextActive: { color: colors.primaryText, fontWeight: '600' },
  accountDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  accountTag: {
    ...typography.label,
    fontSize: 9,
    color: colors.secondary,
    backgroundColor: 'rgba(197, 90, 18, 0.1)',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: radii.sm,
    maxWidth: 96,
  },

  folderGroup: { gap: 2, marginBottom: spacing.md },
  folderAccount: {
    ...typography.label,
    color: colors.textSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  folderHint: { ...typography.caption, color: colors.textMuted, padding: spacing.md },
  folderError: { ...typography.caption, color: colors.dangerText, padding: spacing.sm },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touch.minTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  folderRowActive: { backgroundColor: colors.bgSurfaceHover },
  folderName: { flex: 1, ...typography.bodySmall, color: colors.textMuted },
  folderNameActive: { color: colors.text, fontWeight: '600' },
  folderCount: { ...typography.label, color: colors.textSubtle },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  recentScroll: { flex: 1 },
  recentList: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  recentLabel: { ...typography.label, color: colors.textSubtle, marginRight: 2 },
  recentChip: {
    maxWidth: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
  },
  recentChipText: { ...typography.caption, color: colors.textMuted },
  recentClear: { paddingHorizontal: spacing.xs, minHeight: touch.minTarget, justifyContent: 'center' },
  recentClearText: { ...typography.caption, color: colors.primaryText, fontWeight: '600' },

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
  rowPressed: { backgroundColor: colors.bgSurfaceHover },
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

  threadCount: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.bgSurfaceHover,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  threadCountText: { ...typography.label, fontSize: 10, color: colors.textMuted },

  needsReply: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryBg,
    alignSelf: 'center',
  },
  needsReplyText: { ...typography.label, fontSize: 9, color: colors.primaryText },

  starBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },

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
  sheetItemPressed: { backgroundColor: colors.bgSurfaceHover },
  sheetItemText: { ...typography.body, color: colors.text },
  sheetItemDanger: { color: colors.dangerText },
  sheetCancel: {
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: spacing.sm,
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
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  bannerError: { borderColor: colors.danger },
  bannerText: { ...typography.caption, color: colors.textMuted },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgSurfaceHover,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: colors.primary },
}));