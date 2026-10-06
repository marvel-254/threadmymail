/**
 * Gmail-style inbox chrome — search field, filter chips, and the thread row.
 *
 * Layout follows Gmail's density: sender and date on the top line, subject
 * inline with a truncated preview on the second, an attachment glyph when one is
 * present, and an unread dot that is a dot *and* a weight change so the state
 * is never carried by colour alone.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { formatListTime, type MailFilter, type Message } from '../lib/mail';
import { IconSearch, IconStar, IconX } from './Icons';

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
type ThreadRowProps = {
  message: Message;
  onPress: (id: string) => void;
  onToggleStar: (id: string) => void;
};

export function ThreadRow({ message, onPress, onToggleStar }: ThreadRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${message.from}, ${message.subject}, ${formatListTime(message.date)}`}
      onPress={() => onPress(message.id)}
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

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 72,
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
