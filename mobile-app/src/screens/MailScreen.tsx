/**
 * Mail — Gmail-shaped inbox → thread → compose.
 *
 * The inbox follows Gmail's structure because that is what people already know
 * how to read: search on top, filter chips under it, then a dense list where
 * sender + date sit on one line and subject + preview on the next.
 *
 * Sync rules live in `lib/mail`: history is capped at 180 days and at a hard
 * message ceiling, bodies are never cached, and the banner reports what is
 * actually retained rather than implying the whole mailbox is local.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, EmptyState, Toast } from '../components/ui';
import { Composer, ThreadMessage } from '../components/mail';
import { EscalationCard } from '../components/agent';
import { FilterChips, SearchBar, SyncBanner, ThreadRow } from '../components/inbox';
import { IconBack, IconMail, IconPower, IconSparkle } from '../components/Icons';
import {
  HISTORY_DAYS,
  INITIAL_SYNC_STATE,
  MAX_CACHED_MESSAGES,
  applyCacheCap,
  selectMessages,
  type MailFilter,
  type Message,
  type SyncState,
} from '../lib/mail';
import { loadMessages, markRead as storeMarkRead, setStarred } from '../lib/mailStore';
import { loadAccount } from '../lib/accountStore';
import { getMailSync } from '../lib/mailSyncSingleton';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type MailScreenProps = {
  onOpenAgent: () => void;
  onOpenSettings: () => void;
};

export function MailScreen({ onOpenAgent, onOpenSettings }: MailScreenProps) {
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list');
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MailFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [killEngaged, setKillEngaged] = useState(false);
  const [sync, setSync] = useState<SyncState>(INITIAL_SYNC_STATE);

  // Load persisted messages on mount, then subscribe to the sync engine.
  useEffect(() => {
    let mounted = true;
    loadMessages().then((msgs) => {
      if (mounted) setMessages(msgs);
    });
    const sync = getMailSync();
    const unsub = sync.subscribe((state) => {
      if (mounted) setSync(state);
    });
    setSync(sync.getState());
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const visible = useMemo(
    () => selectMessages(messages, filter, query),
    [messages, filter, query],
  );

  const counts = useMemo<Record<MailFilter, number>>(
    () => ({
      all: messages.length,
      unread: messages.filter((m) => m.unread).length,
      needs_reply: messages.filter((m) => m.needsReply).length,
      starred: messages.filter((m) => m.starred).length,
    }),
    [messages],
  );

  const selected = useMemo(
    () => messages.find((m) => m.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const openThread = (id: string) => {
    setSelectedId(id);
    setView('thread');
    // Mark read locally + on the server (best-effort).
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, unread: false } : m)));
    void getMailSync().markRead(id);
  };

  const toggleStar = (id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)),
    );
    void getMailSync().toggleStar(id);
  };

  /**
   * Pull to refresh. If an account is connected, this continues the history
   * import (or reconnects IDLE); otherwise it reports the honest offline state.
   */
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const sync = getMailSync();
    void loadAccount()
      .then((account) => {
        if (account) {
          return sync.start({
            imap: account.imap,
            auth: { user: account.email, password: account.password },
          });
        }
        setSync((s) => ({ ...s, phase: 'offline' }));
        return undefined;
      })
      .finally(() => setRefreshing(false));
  }, []);

  const sendDraft = (text: string) => {
    const subject = selected?.subject ?? 'New message';
    void getMailSync()
      .send({ to: selected?.fromAddress ?? '', subject, text })
      .then(() => {
        setToast('Message sent');
        setTimeout(() => setToast(null), 2500);
        setView('list');
      })
      .catch((err) => {
        setToast(err instanceof Error ? err.message : 'Send failed');
        setTimeout(() => setToast(null), 3500);
      });
  };

  const header = (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Back"
        onPress={() => (view === 'list' ? undefined : setView('list'))}
        style={styles.headerBtn}
      >
        <IconBack size={22} color={colors.text} />
      </Pressable>
      <Text style={styles.headerTitle}>
        {view === 'list' ? 'Inbox' : view === 'thread' ? selected?.subject ?? 'Thread' : 'New message'}
      </Text>
      <Pressable
        accessibilityLabel="Kill switch"
        onLongPress={() => setKillEngaged((k) => !k)}
        style={[styles.headerBtn, killEngaged && styles.killEngaged]}
      >
        <IconPower size={22} color={killEngaged ? colors.danger : colors.textMuted} />
      </Pressable>
    </View>
  );

  if (view === 'list') {
    return (
      <View style={styles.screen}>
        {header}
        <SearchBar value={query} onChangeText={setQuery} />
        <FilterChips value={filter} onChange={setFilter} counts={counts} />
        <SyncBanner
          phase={sync.phase}
          progress={sync.progress}
          imported={sync.imported}
          cappedAt={sync.cappedAt}
          error={sync.error}
        />
        <FlatList
          data={visible}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <ThreadRow message={item} onPress={openThread} onToggleStar={toggleStar} />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            messages.length === 0 ? (
              <EmptyState
                icon={<IconMail size={48} color={colors.textSubtle} />}
                title="No mail yet"
                body={`Connect an email account and Millo will import the last ${HISTORY_DAYS} days, then watch for new messages.`}
                action={
                  <Button label="Connect an account" variant="secondary" onPress={onOpenSettings} />
                }
              />
            ) : (
              <EmptyState
                icon={<IconMail size={48} color={colors.textSubtle} />}
                title="Nothing matches"
                body="Try a different search or filter."
              />
            )
          }
          ListFooterComponent={
            messages.length > 0 ? (
              <Text style={styles.footerNote}>
                Showing {visible.length} of {messages.length} cached ·{' '}
                {HISTORY_DAYS}-day history · capped at{' '}
                {MAX_CACHED_MESSAGES.toLocaleString()} messages
              </Text>
            ) : null
          }
        />
        {toast && <Toast visible message={toast} />}
      </View>
    );
  }

  if (view === 'thread') {
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView contentContainerStyle={styles.threadContent}>
          {selected ? (
            <>
              <ThreadMessage
                msg={{
                  id: selected.id,
                  sender: selected.from,
                  email: selected.fromAddress,
                  time: new Date(selected.date).toLocaleString(),
                  body: selected.body ?? selected.preview,
                }}
              />
              <EscalationCard
                question="Millo can draft a reply. Want it to?"
                choices={[{ label: 'Yes', primary: true }, { label: 'No' }]}
                onChoose={(c) => {
                  if (c === 'Yes') setView('compose');
                }}
              />
            </>
          ) : (
            <EmptyState
              icon={<IconMail size={48} color={colors.textSubtle} />}
              title="Thread unavailable"
              body="This message could not be loaded."
            />
          )}
        </ScrollView>
        <View style={styles.composerBar}>
          <Composer placeholder="Reply…" onSend={sendDraft} onAskAgent={onOpenAgent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView contentContainerStyle={styles.composeContent}>
        <Text style={styles.composeField}>To:</Text>
        <Text style={styles.composeField}>Cc: (optional)</Text>
        <Text style={styles.composeField}>Subject:</Text>
        <View style={styles.composeDivider} />
        <Button
          label="Draft with Millo"
          variant="accent"
          onPress={() => {}}
          icon={<IconSparkle size={18} color={colors.textOnAccent} />}
        />
      </ScrollView>
      <View style={styles.composerBar}>
        <Button label="Send" onPress={() => sendDraft('')} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    minHeight: 56,
    gap: spacing.sm,
  },
  headerBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  killEngaged: { backgroundColor: colors.dangerBg },
  headerTitle: { flex: 1, ...typography.h3, color: colors.text },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg + 10 + spacing.sm },
  footerNote: {
    ...typography.caption,
    color: colors.textSubtle,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  threadContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  composerBar: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  composeContent: { padding: spacing.lg, gap: spacing.lg },
  composeField: { ...typography.body, color: colors.textMuted },
  composeDivider: { height: 1, backgroundColor: colors.border },
});
