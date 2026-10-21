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
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, ConfirmDialog, EmptyState, Toast } from '../components/ui';
import { Composer, ThreadMessage } from '../components/mail';
import { DraftCard } from '../components/drafts';
import { FilterChips, SearchBar, SyncBanner, ThreadRow } from '../components/inbox';
import { IconBack, IconMail, IconPower, IconSend } from '../components/Icons';
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
import { colors, radii, shadows, spacing, touch, typography } from '../theme/theme';

type MailScreenProps = {
  onOpenAgent: () => void;
  onOpenSettings: () => void;
  threadId?: string;
  draftId?: string;
};

export function MailScreen({ onOpenAgent, onOpenSettings, threadId, draftId }: MailScreenProps) {
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list');
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MailFilter>('all');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirmKill, setConfirmKill] = useState(false);
  const { killSwitch: killEngaged, shadowMode } = useGuardrails();
  const [sync, setSync] = useState<SyncState>(INITIAL_SYNC_STATE);
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
  const [body, setBody] = useState<{ id: string; text: string } | null>(null);
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  const [bodyAttempt, setBodyAttempt] = useState(0);

  // Open specific thread if threadId is provided
  useEffect(() => {
    if (threadId) {
      setSelectedId(threadId);
      setView('thread');
    }
  }, [threadId]);

  // Open a queued draft in the compose editor when Today sends one over.
  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    void getDraft(draftId).then((draft) => {
      if (cancelled || !draft || draft.status !== 'pending') return;
      setComposeTo(draft.to);
      setComposeCc('');
      setComposeSubject(draft.subject);
      setComposeBody(draft.body);
      setComposeDraftId(draft.id);
      setView('compose');
    });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

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

  const activeThreadId = selected?.threadId;

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

  // Fetch the real body when a thread opens. MailSync caches it in memory for
  // the session, so opening the same message again is effectively instant.
  useEffect(() => {
    if (view !== 'thread' || !selectedId) return;
    let cancelled = false;
    setBodyLoading(true);
    setBodyError(null);
    void getMailSync()
      .fetchBody(selectedId)
      .then((result) => {
        if (!cancelled) setBody({ id: selectedId, text: result.text });
      })
      .catch((err) => {
        if (!cancelled) {
          setBodyError(err instanceof Error ? err.message : 'Could not load this message.');
        }
      })
      .finally(() => {
        if (!cancelled) setBodyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, selectedId, bodyAttempt]);

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
      const bodyText = (body?.id === selected.id ? body.text : '') || selected.body || selected.preview;
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

  const showToast = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), ok ? 2500 : 4000);
  };

  const sendDraft = (text: string) => {
    if (!text.trim()) {
      showToast('Write a reply before sending.', false);
      return;
    }
    const subject = selected?.subject ?? 'New message';
    void getMailSync()
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
    setView('compose');
  };

  const openReplyCompose = () => {
    setComposeTo(selected?.fromAddress ?? '');
    setComposeCc('');
    setComposeSubject(selected?.subject ? `Re: ${selected.subject}` : '');
    setComposeBody('');
    setComposeDraftId(null);
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
      await getMailSync().send({
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
      <Pressable
        accessibilityLabel="Back"
        onPress={() => (view === 'list' ? undefined : setView('list'))}
        style={styles.headerBtn}
      >
        <IconBack size={22} color={colors.text} />
      </Pressable>
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
        {toast && <Toast visible message={toast.text} ok={toast.ok} />}
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
          {selected ? (
            <>
              <ThreadMessage
                msg={{
                  id: selected.id,
                  sender: selected.from,
                  email: selected.fromAddress,
                  time: new Date(selected.date).toLocaleString(),
                  body: (body?.id === selected.id && body.text) || selected.body || selected.preview,
                }}
              />
              {bodyLoading && (
                <View style={styles.bodyStatus}>
                  <ActivityIndicator color={colors.primary} size="small" />
                  <Text style={styles.bodyStatusText}>Loading the full message…</Text>
                </View>
              )}
              {!bodyLoading && bodyError && (
                <View style={styles.bodyError}>
                  <Text style={styles.bodyErrorText}>Showing preview only — {bodyError}</Text>
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
              title="Thread unavailable"
              body="This message could not be loaded."
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
});
