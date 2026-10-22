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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, ConfirmDialog, EmptyState, Toast } from '../components/ui';
import { Composer, ThreadMessage } from '../components/mail';
import { DraftCard } from '../components/drafts';
import {
  AccountChips,
  FilterChips,
  MailActionSheet,
  RecentSearches,
  SearchBar,
  SyncBanner,
  ThreadRow,
} from '../components/inbox';
import { IconBack, IconMail, IconPower, IconSend } from '../components/Icons';
import {
  HISTORY_DAYS,
  INITIAL_SYNC_STATE,
  MAX_CACHED_MESSAGES,
  buildThreads,
  selectThreads,
  type MailFilter,
  type Message,
  type SyncState,
  type Thread,
} from '../lib/mail';
import { countUnreadByAccount, loadMessage, loadMessages } from '../lib/mailStore';
import { addRecentSearch, clearRecentSearches, loadRecentSearches } from '../lib/searchHistory';
import { undoActivity } from '../lib/agent/activityStore';
import { loadAccounts, type AccountConfig } from '../lib/accountStore';
import {
  getMailSync,
  registerMailAccounts,
  subscribeAllMailSync,
} from '../lib/mailSyncSingleton';
import { setKillSwitch, useGuardrails } from '../lib/guardrails';
import {
  dismissDraftPrompt,
  getDraft,
  isDraftPromptDismissed,
  loadPendingDraftForThread,
  type Draft,
} from '../lib/agent/draftStore';
import {
  discardDraft,
  generateDraft,
  recordEditedDraftSent,
  sendDraft as sendQueuedDraft,
} from '../lib/agent/drafts';
import { themedStyles, colors, radii, shadows, spacing, touch, typography } from '../theme/theme';

function shortAccount(email?: string): string | undefined {
  return email ? email.split('@')[0] : undefined;
}

type MailScreenProps = {
  onOpenAgent: () => void;
  onOpenSettings: () => void;
  threadId?: string;
  draftId?: string;
  initialFilter?: MailFilter;
  composeOnOpen?: boolean;
};

export function MailScreen({
  onOpenAgent,
  onOpenSettings,
  threadId,
  draftId,
  initialFilter,
  composeOnOpen,
}: MailScreenProps) {
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list');
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MailFilter>(initialFilter ?? 'all');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);
  const [serverSearching, setServerSearching] = useState(false);
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{
    text: string;
    ok: boolean;
    undoId?: string | null;
  } | null>(null);
  const [actionThread, setActionThread] = useState<Thread | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const { killSwitch: killEngaged, shadowMode } = useGuardrails();
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [unreadByAccount, setUnreadByAccount] = useState<Record<string, number>>({});
  const [syncByAccount, setSyncByAccount] = useState<Record<string, SyncState>>({});
  const [composeAccountId, setComposeAccountId] = useState<string | undefined>();
  const [threadDraft, setThreadDraft] = useState<Draft | null>(null);
  const [draftPromptDismissed, setDraftPromptDismissed] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftGenerating, setDraftGenerating] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [composeDraftId, setComposeDraftId] = useState<string | null>(null);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [sending, setSending] = useState(false);
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyErrors, setBodyErrors] = useState<Record<string, string>>({});
  const [bodyAttempt, setBodyAttempt] = useState(0);
  const handledThreadLink = useRef<string | undefined>(undefined);

  const reloadMessages = useCallback(async () => {
    setMessages(await loadMessages(accountFilter === 'all' ? undefined : accountFilter));
    setUnreadByAccount(await countUnreadByAccount());
  }, [accountFilter]);
  const reloadRef = useRef(reloadMessages);
  useEffect(() => {
    reloadRef.current = reloadMessages;
  }, [reloadMessages]);

  const runServerSearch = useCallback(async (input = query) => {
    const term = input.trim();
    if (term.length < 2 || serverSearching) return;
    setServerSearching(true);
    setServerMessage(null);
    setRecents(await addRecentSearch(term));
    const targets = accountFilter === 'all'
      ? accounts
      : accounts.filter((account) => account.id === accountFilter);
    try {
      const results = await Promise.allSettled(
        (targets.length > 0 ? targets.map((account) => account.id) : [undefined])
          .map((accountId) => getMailSync(accountId).searchServer(term)),
      );
      const found = results.reduce(
        (sum, result) => sum + (result.status === 'fulfilled' ? result.value.length : 0),
        0,
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected' && found === 0) throw failed.reason;
      await reloadMessages();
      setServerMessage(
        found === 0
          ? 'No matches on the server.'
          : `Added ${found} server match${found === 1 ? '' : 'es'}${failed ? ' — one account failed' : ''}.`,
      );
    } catch (err) {
      setServerMessage(err instanceof Error ? err.message : 'Server search failed.');
    } finally {
      setServerSearching(false);
    }
  }, [accounts, accountFilter, query, reloadMessages, serverSearching]);

  const clearRecents = useCallback(async () => {
    await clearRecentSearches();
    setRecents([]);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Debounce filtering so typing stays smooth with the full 5,000-message cache.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setServerMessage(null);
  }, [query]);

  useEffect(() => {
    void loadRecentSearches().then(setRecents);
  }, []);

  // Deep links from Today: filter, then compose.
  useEffect(() => {
    if (initialFilter) setFilter(initialFilter);
  }, [initialFilter]);

  useEffect(() => {
    if (!composeOnOpen) return;
    setComposeTo('');
    setComposeCc('');
    setComposeSubject('');
    setComposeBody('');
    setComposeDraftId(null);
    setComposeAccountId(accounts.find((account) => account.primary)?.id ?? accounts[0]?.id);
    setView('compose');
  }, [accounts, composeOnOpen]);

  // Deep links may carry either a message id or a conversation id.
  useEffect(() => {
    if (!threadId) {
      handledThreadLink.current = undefined;
      return;
    }
    if (handledThreadLink.current === threadId) return;
    const match = messages.find((message) => message.id === threadId);
    if (!match && messages.length === 0) return;
    setSelectedId(match?.threadId ?? threadId);
    setView('thread');
    handledThreadLink.current = threadId;
  }, [threadId, messages]);

  // Open a queued draft in the compose editor when Today sends one over.
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    void (async () => {
      const draft = await getDraft(draftId);
      if (cancelled || !draft || draft.status !== 'pending') return;
      const message = draft.messageId ? await loadMessage(draft.messageId) : null;
      if (cancelled) return;
      setComposeTo(draft.to);
      setComposeCc('');
      setComposeSubject(draft.subject);
      setComposeBody(draft.body);
      setComposeDraftId(draft.id);
      setComposeAccountId(
        message?.accountId
        ?? accounts.find((account) => account.primary)?.id
        ?? accounts[0]?.id,
      );
      setView('compose');
    })();
    return () => {
      cancelled = true;
    };
  }, [accounts, draftId]);

  useEffect(() => {
    let mounted = true;
    void loadAccounts().then((saved) => {
      if (!mounted) return;
      setAccounts(saved);
      registerMailAccounts(saved);
      setAccountFilter((current) => (
        current !== 'all' && !saved.some((account) => account.id === current)
          ? 'all'
          : current
      ));
      setComposeAccountId((current) => (
        current ?? saved.find((account) => account.primary)?.id ?? saved[0]?.id
      ));
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void reloadMessages();
  }, [reloadMessages]);

  // Subscribe to every account so the unified list and per-account banners stay live.
  useEffect(() => {
    if (accounts.length === 0) return;
    registerMailAccounts(accounts);
    setSyncByAccount((previous) => {
      const next = { ...previous };
      for (const account of accounts) next[account.id] = getMailSync(account.id).getState();
      return next;
    });
    const unsubscribe = subscribeAllMailSync((accountId, state) => {
      setSyncByAccount((previous) => ({ ...previous, [accountId]: state }));
      void reloadRef.current();
    });
    return unsubscribe;
  }, [accounts]);

  const threads = useMemo(() => buildThreads(messages), [messages]);

  const visible = useMemo(
    () => selectThreads(threads, filter, debouncedQuery),
    [threads, filter, debouncedQuery],
  );

  const counts = useMemo<Record<MailFilter, number>>(
    () => ({
      all: threads.length,
      unread: threads.filter((thread) => thread.unreadCount > 0).length,
      needs_reply: threads.filter((thread) => thread.needsReply).length,
      starred: threads.filter((thread) => thread.starred).length,
    }),
    [threads],
  );

  const threadMessages = useMemo(
    () => messages
      .filter((message) => message.threadId === selectedId)
      .sort((a, b) => a.date.localeCompare(b.date)),
    [messages, selectedId],
  );

  const threadMessageKey = threadMessages.map((message) => message.id).join(',');
  const selected = threadMessages[threadMessages.length - 1] ?? null;
  const activeThreadId = selected?.threadId;

  const engineForThread = (id: string) => {
    const accountId = threads.find((thread) => thread.id === id)?.accountId;
    return getMailSync(accountId);
  };

  useEffect(() => {
    setBodyErrors({});
  }, [selectedId]);

  // Load the pending draft / dismissal for the open thread.
  useEffect(() => {
    if (view !== 'thread' || !activeThreadId) {
      setThreadDraft(null);
      setDraftPromptDismissed(false);
      return;
    }
    let cancelled = false;
    setDraftLoading(true);
    void Promise.all([
      loadPendingDraftForThread(activeThreadId),
      isDraftPromptDismissed(activeThreadId),
    ])
      .then(([draft, dismissed]) => {
        if (cancelled) return;
        setThreadDraft(draft);
        setDraftPromptDismissed(dismissed);
      })
      .finally(() => {
        if (!cancelled) setDraftLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, activeThreadId]);

  // Fetch bodies for the whole conversation when it opens. MailSync caches them
  // in memory for the session, so re-opening a thread is effectively instant.
  useEffect(() => {
    if (view !== 'thread' || !selectedId || threadMessages.length === 0) return;
    let cancelled = false;
    setBodyLoading(true);
    void Promise.all(threadMessages.map(async (message) => {
      if (bodies[message.id]) return;
      try {
        const result = await getMailSync(message.accountId).fetchBody(message.id);
        if (!cancelled) {
          setBodies((prev) => ({ ...prev, [message.id]: result.text }));
          setBodyErrors((prev) => {
            if (!prev[message.id]) return prev;
            const next = { ...prev };
            delete next[message.id];
            return next;
          });
        }
      } catch (err) {
        if (!cancelled) {
          setBodyErrors((prev) => ({
            ...prev,
            [message.id]: err instanceof Error ? err.message : 'Could not load this message.',
          }));
        }
      }
    })).finally(() => {
      if (!cancelled) setBodyLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // threadMessageKey tracks membership; bodies is intentionally pre-checked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, threadMessageKey, bodyAttempt]);

  const openThread = (id: string) => {
    setSelectedId(id);
    setView('thread');
    // Mark the whole conversation read locally + on the server (best-effort).
    setMessages((prev) => prev.map((m) => (
      m.threadId === id ? { ...m, unread: false } : m
    )));
    void engineForThread(id).setThreadRead(id, true);
  };

  const toggleStar = (id: string) => {
    const thread = threads.find((item) => item.id === id);
    if (!thread) return;
    const starred = !thread.starred;
    setMessages((prev) => prev.map((m) => (
      m.threadId === id ? { ...m, starred } : m
    )));
    void engineForThread(id).toggleThreadStar(id);
  };

  const toggleRead = (id: string) => {
    const thread = threads.find((item) => item.id === id);
    if (!thread) return;
    const unread = thread.unreadCount === 0;
    setMessages((prev) => prev.map((m) => (
      m.threadId === id ? { ...m, unread } : m
    )));
    void engineForThread(id)
      .toggleThreadRead(id)
      .then(() => showToast(unread ? 'Marked unread' : 'Marked read'))
      .catch(async (err) => {
        await reloadMessages();
        showToast(err instanceof Error ? err.message : 'Could not change read state.', false);
      });
  };

  const archiveThread = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.threadId !== id));
    void engineForThread(id)
      .archiveThread(id)
      .then((result) => {
        if (result.serverChanged) {
          showToast('Conversation archived', true, result.activityId);
        } else {
          showToast(
            `Archived on this device${result.error ? ` — ${result.error}` : ''}`,
            false,
            result.activityId,
          );
        }
      })
      .catch(async (err) => {
        await reloadMessages();
        showToast(err instanceof Error ? err.message : 'Archive failed.', false);
      });
  };

  const removeThread = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.threadId !== id));
    void engineForThread(id)
      .removeThread(id)
      .then((result) => {
        if (result.serverChanged) {
          showToast('Conversation deleted', true, result.activityId);
        } else {
          showToast(
            `Deleted on this device${result.error ? ` — ${result.error}` : ''}`,
            false,
            result.activityId,
          );
        }
      })
      .catch(async (err) => {
        await reloadMessages();
        showToast(err instanceof Error ? err.message : 'Delete failed.', false);
      });
  };

  const deleteThread = (id: string) => {
    const thread = threads.find((item) => item.id === id);
    Alert.alert(
      'Delete conversation?',
      thread
        ? `"${thread.subject}" (${thread.messageCount} message${thread.messageCount === 1 ? '' : 's'}) will move to Trash.`
        : 'This conversation will move to Trash.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => removeThread(id) },
      ],
    );
  };

  const openDraftInCompose = (draft: Draft) => {
    setComposeTo(draft.to);
    setComposeCc('');
    setComposeSubject(draft.subject);
    setComposeBody(draft.body);
    setComposeDraftId(draft.id);
    setView('compose');
  };

  const handleGenerateDraft = async () => {
    if (!selected || draftGenerating) return;
    setDraftGenerating(true);
    try {
      const bodyText = bodies[selected.id] || selected.body || selected.preview;
      const result = await generateDraft(selected, bodyText);
      if (result.ok) {
        setThreadDraft(result.draft);
        showToast(result.shadowed ? 'Draft queued (shadow mode)' : 'Draft ready');
      } else {
        showToast(result.error, false);
      }
    } finally {
      setDraftGenerating(false);
    }
  };

  const handleDismissDraftPrompt = async () => {
    if (!activeThreadId) return;
    await dismissDraftPrompt(activeThreadId);
    setDraftPromptDismissed(true);
  };

  const handleSendThreadDraft = async () => {
    if (!threadDraft || draftBusy) return;
    setDraftBusy(true);
    const result = await sendQueuedDraft(threadDraft);
    setDraftBusy(false);
    if (result.ok) {
      setThreadDraft(null);
      setDraftPromptDismissed(true);
      showToast(`Draft sent to ${threadDraft.to}`);
    } else {
      showToast(result.error, false);
    }
  };

  const handleDiscardThreadDraft = async () => {
    if (!threadDraft || draftBusy) return;
    setDraftBusy(true);
    await discardDraft(threadDraft);
    if (activeThreadId) await dismissDraftPrompt(activeThreadId);
    setDraftBusy(false);
    setThreadDraft(null);
    setDraftPromptDismissed(true);
    showToast('Draft discarded');
  };

  /**
   * Pull to refresh. If an account is connected, this continues the history
   * import (or reconnects IDLE); otherwise it reports the honest offline state.
   */
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    const targets = accountFilter === 'all'
      ? accounts
      : accounts.filter((account) => account.id === accountFilter);
    void Promise.all(targets.map((account) => getMailSync(account.id).start({
      imap: account.imap,
      smtp: account.smtp,
      auth: { user: account.email, password: account.password },
    }))).finally(() => setRefreshing(false));
  }, [accountFilter, accounts]);

  const showToast = (text: string, ok = true, undoId?: string | null) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, ok, undoId });
    toastTimer.current = setTimeout(() => setToast(null), undoId ? 6000 : ok ? 2500 : 4000);
  };

  const handleUndo = async () => {
    const undoId = toast?.undoId;
    if (!undoId) return;
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
    const result = await undoActivity(undoId);
    if (result.ok) {
      await reloadMessages();
      showToast('Action undone');
    } else {
      showToast(result.error ?? 'Undo failed.', false);
    }
  };

  const sendDraft = (text: string) => {
    if (!text.trim()) {
      showToast('Write a reply before sending.', false);
      return;
    }
    const subject = selected?.subject ?? 'New message';
    void getMailSync(selected?.accountId)
      .send({ to: selected?.fromAddress ?? '', subject, text })
      .then(() => {
        showToast('Message sent');
        setView('list');
      })
      .catch((err) => {
        showToast(err instanceof Error ? err.message : 'Send failed', false);
      });
  };

  const openCompose = () => {
    setComposeTo('');
    setComposeCc('');
    setComposeSubject('');
    setComposeBody('');
    setComposeDraftId(null);
    setComposeAccountId(
      accountFilter === 'all'
        ? accounts.find((account) => account.primary)?.id ?? accounts[0]?.id
        : accountFilter,
    );
    setView('compose');
  };

  const parseAddresses = (value: string) =>
    value.split(/[,;]/).map((part) => part.trim()).filter(Boolean);

  const sendCompose = async () => {
    const to = parseAddresses(composeTo);
    const cc = parseAddresses(composeCc);
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (to.length === 0) {
      showToast('Add at least one recipient.', false);
      return;
    }
    const invalid = [...to, ...cc].find((address) => !emailPattern.test(address));
    if (invalid) {
      showToast(`Check this address: ${invalid}`, false);
      return;
    }
    if (!composeBody.trim()) {
      showToast('Write a message before sending.', false);
      return;
    }

    setSending(true);
    const editedDraftId = composeDraftId;
    try {
      await getMailSync(composeAccountId ?? selected?.accountId).send({
        to,
        cc: cc.length > 0 ? cc : undefined,
        subject: composeSubject.trim() || '(no subject)',
        text: composeBody,
      });
      if (editedDraftId) {
        try {
          await recordEditedDraftSent(editedDraftId, composeBody);
        } catch {
          // The mail was sent; the queue bookkeeping is best-effort.
        }
      }
      showToast('Message sent');
      setView('list');
      setComposeTo('');
      setComposeCc('');
      setComposeSubject('');
      setComposeBody('');
      setComposeDraftId(null);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Send failed', false);
    } finally {
      setSending(false);
    }
  };

  const header = (
    <View style={styles.header}>
      {view === 'list' ? (
        <View style={styles.headerBtn} />
      ) : (
        <Pressable
          accessibilityLabel="Back"
          onPress={() => setView('list')}
          style={styles.headerBtn}
        >
          <IconBack size={22} color={colors.text} />
        </Pressable>
      )}
      <Text style={styles.headerTitle}>
        {view === 'list'
          ? 'Inbox'
          : view === 'thread'
            ? selected?.subject ?? 'Thread'
            : composeDraftId ? 'Edit draft' : 'New message'}
      </Text>
      <Pressable
        accessibilityLabel={killEngaged ? 'Resume autonomous actions' : 'Stop autonomous actions'}
        accessibilityHint={killEngaged ? 'Tap to resume autonomy' : 'Tap to engage the kill switch'}
        onPress={() => setConfirmKill(true)}
        style={[styles.headerBtn, killEngaged && styles.killEngaged]}
      >
        <IconPower size={22} color={killEngaged ? colors.danger : colors.textMuted} />
      </Pressable>
    </View>
  );

  const killDialog = (
    <ConfirmDialog
      visible={confirmKill}
      title={killEngaged ? 'Resume autonomous actions?' : 'Stop all autonomous actions?'}
      body={killEngaged
        ? 'Millo will start triaging, drafting, and following up again.'
        : 'Millo will stop triaging, drafting, and following up. You can still read and send mail yourself.'}
      confirmLabel={killEngaged ? 'Resume' : 'Stop'}
      destructive={!killEngaged}
      onConfirm={() => {
        void setKillSwitch(!killEngaged);
        setConfirmKill(false);
      }}
      onCancel={() => setConfirmKill(false)}
    />
  );

  if (view === 'list') {
    return (
      <View style={styles.screen}>
        {header}
        <AccountChips
          accounts={accounts}
          value={accountFilter}
          onChange={setAccountFilter}
          unreadCounts={unreadByAccount}
        />
        <SearchBar
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={(value) => void runServerSearch(value)}
        />
        <FilterChips value={filter} onChange={setFilter} counts={counts} />
        {query.trim().length === 0 && (
          <RecentSearches
            items={recents}
            onSelect={setQuery}
            onClear={() => void clearRecents()}
          />
        )}
        {query.trim().length >= 2 && (
          <View style={styles.serverRow}>
            <Button
              label={serverSearching ? 'Searching' : 'Search server'}
              variant="secondary"
              loading={serverSearching}
              onPress={() => void runServerSearch()}
            />
            <Text style={styles.serverHint} numberOfLines={2}>
              {serverMessage ?? 'Search the whole mailbox, including older mail and message bodies.'}
            </Text>
          </View>
        )}
        {debouncedQuery.trim().length > 0 && (
          <Text style={styles.resultCount}>
            {visible.length} result{visible.length === 1 ? '' : 's'}
            {serverSearching ? ' · searching server…' : ''}
          </Text>
        )}
        {(accountFilter === 'all'
          ? accounts
          : accounts.filter((account) => account.id === accountFilter)
        ).map((account) => {
          const state = syncByAccount[account.id] ?? INITIAL_SYNC_STATE;
          const worthShowing = accountFilter !== 'all'
            || (state.phase !== 'idle' && state.phase !== 'idle-watching')
            || !!state.error
            || state.cappedAt !== null;
          if (!worthShowing) return null;
          return (
            <View key={account.id}>
              {accounts.length > 1 && (
                <Text style={styles.syncAccount} numberOfLines={1}>{account.email}</Text>
              )}
              <SyncBanner
                phase={state.phase}
                progress={state.progress}
                imported={state.imported}
                cappedAt={state.cappedAt}
                error={state.error}
              />
            </View>
          );
        })}
        <FlatList
          data={visible}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              accountLabel={accounts.length > 1 && accountFilter === 'all'
                ? shortAccount(accounts.find((account) => account.id === item.accountId)?.email)
                : undefined}
              onPress={openThread}
              onToggleStar={toggleStar}
              onToggleRead={toggleRead}
              onArchive={archiveThread}
              onDelete={deleteThread}
              onShowActions={setActionThread}
            />
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
                Showing {visible.length} of {threads.length} conversations ·{' '}
                {messages.length} messages cached · {HISTORY_DAYS}-day history · capped at{' '}
                {MAX_CACHED_MESSAGES.toLocaleString()} messages
              </Text>
            ) : null
          }
        />
        {toast && (
          <Toast
            visible
            message={toast.text}
            ok={toast.ok}
            actionLabel={toast.undoId ? 'Undo' : undefined}
            onAction={toast.undoId ? () => void handleUndo() : undefined}
          />
        )}
        <MailActionSheet
          thread={actionThread}
          onClose={() => setActionThread(null)}
          onToggleRead={toggleRead}
          onArchive={archiveThread}
          onDelete={deleteThread}
        />
        <Pressable
          accessibilityLabel="Compose email"
          onPress={openCompose}
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.9 }]}
        >
          <IconSend size={24} color={colors.textOnPrimary} />
        </Pressable>
        {killDialog}
      </View>
    );
  }

  if (view === 'thread') {
    return (
      <View style={styles.screen}>
        {header}
        <ScrollView contentContainerStyle={styles.threadContent}>
          {threadMessages.length > 0 ? (
            <>
              {threadMessages.map((message, index) => (
                <ThreadMessage
                  key={message.id}
                  defaultCollapsed={index < threadMessages.length - 1}
                  msg={{
                    id: message.id,
                    sender: message.from,
                    email: message.fromAddress,
                    time: new Date(message.date).toLocaleString(),
                    body: bodies[message.id] || message.body || message.preview,
                  }}
                />
              ))}
              {bodyLoading && (
                <View style={styles.bodyStatus}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={styles.bodyStatusText}>Loading the full conversation…</Text>
                </View>
              )}
              {Object.keys(bodyErrors).length > 0 && (
                <View style={styles.bodyError}>
                  <Text style={styles.bodyErrorText}>
                    Some messages are showing previews only.
                  </Text>
                  <Button
                    label="Retry"
                    variant="secondary"
                    onPress={() => setBodyAttempt((n) => n + 1)}
                  />
                </View>
              )}
              {draftLoading ? (
                <View style={styles.draftLoading}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={styles.bodyStatusText}>Checking for a draft…</Text>
                </View>
              ) : threadDraft ? (
                <DraftCard
                  draft={threadDraft}
                  shadow={shadowMode}
                  busy={draftBusy}
                  onSend={() => void handleSendThreadDraft()}
                  onEdit={() => openDraftInCompose(threadDraft)}
                  onDiscard={() => void handleDiscardThreadDraft()}
                />
              ) : !draftPromptDismissed ? (
                <View style={styles.draftPrompt}>
                  <Text style={styles.draftPromptText}>
                    {draftGenerating
                      ? 'Millo is writing a draft…'
                      : 'Millo can draft a reply. Want it to?'}
                  </Text>
                  {draftGenerating ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : (
                    <View style={styles.draftPromptActions}>
                      <Button
                        label="Draft it"
                        onPress={() => void handleGenerateDraft()}
                      />
                      <Button
                        label="No"
                        variant="secondary"
                        onPress={() => void handleDismissDraftPrompt()}
                      />
                    </View>
                  )}
                </View>
              ) : (
                <Button
                  label={draftGenerating ? 'Drafting…' : 'Draft with Millo'}
                  variant="secondary"
                  loading={draftGenerating}
                  onPress={() => void handleGenerateDraft()}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={<IconMail size={48} color={colors.textSubtle} />}
              title="Conversation unavailable"
              body="These messages could not be loaded."
            />
          )}
        </ScrollView>
        <View style={styles.composerBar}>
          <Composer placeholder="Reply…" onSend={sendDraft} onAskAgent={onOpenAgent} />
        </View>
        {toast && <Toast visible message={toast.text} ok={toast.ok} />}
        {killDialog}
      </View>
    );
  }

  const canSend = !sending && composeTo.trim().length > 0 && composeBody.trim().length > 0;

  return (
    <View style={styles.screen}>
      {header}
      <ScrollView
        contentContainerStyle={styles.composeContent}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.composeLabel}>To</Text>
        <TextInput
          value={composeTo}
          onChangeText={setComposeTo}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="name@example.com, other@example.com"
          placeholderTextColor={colors.textSubtle}
          style={styles.composeInput}
        />

        <Text style={styles.composeLabel}>Cc</Text>
        <TextInput
          value={composeCc}
          onChangeText={setComposeCc}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Optional"
          placeholderTextColor={colors.textSubtle}
          style={styles.composeInput}
        />

        <Text style={styles.composeLabel}>Subject</Text>
        <TextInput
          value={composeSubject}
          onChangeText={setComposeSubject}
          placeholder="Subject"
          placeholderTextColor={colors.textSubtle}
          style={styles.composeInput}
        />

        <View style={styles.composeDivider} />
        <TextInput
          value={composeBody}
          onChangeText={setComposeBody}
          multiline
          textAlignVertical="top"
          placeholder="Write your message…"
          placeholderTextColor={colors.textSubtle}
          style={[styles.composeInput, styles.composeBodyInput]}
        />
      </ScrollView>
      <View style={styles.composerBar}>
        <Button
          label={sending ? 'Sending…' : 'Send'}
          onPress={() => { void sendCompose(); }}
          disabled={!canSend}
          loading={sending}
          fullWidth
        />
      </View>
      {toast && <Toast visible message={toast.text} ok={toast.ok} />}
      {killDialog}
    </View>
  );
}

const styles = themedStyles(() => ({
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
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  serverHint: { flex: 1, ...typography.caption, color: colors.textSubtle },
  syncAccount: {
    ...typography.label,
    color: colors.textSubtle,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  resultCount: {
    ...typography.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  separator: { height: 1, backgroundColor: colors.border, marginLeft: spacing.lg + 10 + spacing.sm },
  footerNote: {
    ...typography.caption,
    color: colors.textSubtle,
    textAlign: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  threadContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  bodyStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  bodyStatusText: { ...typography.bodySmall, color: colors.textMuted },
  bodyError: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bodyErrorText: { ...typography.bodySmall, color: colors.textMuted },
  draftLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  draftPrompt: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
    backgroundColor: colors.surface,
  },
  draftPromptText: { ...typography.bodySmall, color: colors.text },
  draftPromptActions: { flexDirection: 'row', gap: spacing.sm },
  composerBar: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  composeContent: { padding: spacing.lg, gap: spacing.sm, paddingBottom: spacing.xxl },
  composeLabel: { ...typography.label, color: colors.textSubtle, marginTop: spacing.sm },
  composeInput: {
    minHeight: touch.minTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    ...typography.body,
    color: colors.text,
  },
  composeBodyInput: {
    minHeight: 220,
    paddingTop: spacing.md,
  },
  composeDivider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.md },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    ...shadows.float,
  },
}));
