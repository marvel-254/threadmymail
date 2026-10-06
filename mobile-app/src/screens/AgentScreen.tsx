/**
 * Agent — the live conversation stream (the heart of the product).
 * MVP-UI §4.3 · DB: Streaming (token-by-token), Disclaimer (AI label),
 * Feedback Loop (thumbs), Typing indicators, Empty States.
 *
 * Responsiveness improvements:
 *  - Auto-scroll to newest message (with onContentSizeChange + onLayout)
 *  - KeyboardAvoidingView so the composer stays above the keyboard
 *  - Real token-by-token streaming (typewriter) instead of a single swap
 *  - User bubbles (right-aligned) so the conversation reads naturally
 *  - Quick suggestion chips for one-tap prompts
 *  - Dismiss keyboard on scroll
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { AgentBubble, EscalationCard, ToolChip } from '../components/agent';
import { Composer } from '../components/mail';
import { EmptyState } from '../components/ui';
import { IconAgent, IconBack, IconPower } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type StreamItem =
  | { type: 'agent'; id: string; text: string; streaming?: boolean }
  | { type: 'user'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; args: string; latencyMs: number; ok: boolean }
  | { type: 'escalation'; id: string; question: string };

const INITIAL: StreamItem[] = [
  { type: 'agent', id: 'a1', text: 'I found 3 threads waiting on you. Top: Acme contract — reply by 5pm.' },
  { type: 'tool', id: 't1', name: 'imap.search', args: '"from:acme"', latencyMs: 42, ok: true },
  { type: 'tool', id: 't2', name: 'memory.recall', args: '"acme contract"', latencyMs: 18, ok: true },
  { type: 'agent', id: 'a2', text: 'Want me to draft a reply?' },
  { type: 'escalation', id: 'e1', question: 'I can draft a reply. Want me to?' },
];

const SUGGESTIONS = [
  'Summarize today\'s mail',
  'Draft a reply to Acme',
  'What needs my attention?',
  'Follow up on the proposal',
];

/** Stream a reply token-by-token (typewriter) into a new agent bubble. */
function streamReply(
  setItems: React.Dispatch<React.SetStateAction<StreamItem[]>>,
  fullText: string,
  id: string,
  chunkMs = 24,
) {
  let i = 0;
  const timer = setInterval(() => {
    i += 2; // 2 chars per tick keeps it snappy on-device
    const slice = fullText.slice(0, i);
    setItems((prev) => {
      const exists = prev.some((it) => it.id === id);
      if (!exists) {
        return [...prev, { type: 'agent', id, text: slice, streaming: true }];
      }
      return prev.map((it) =>
        it.id === id ? { ...it, text: slice, streaming: i < fullText.length } : it,
      );
    });
    if (i >= fullText.length) clearInterval(timer);
  }, chunkMs);
  return () => clearInterval(timer);
}

type AgentScreenProps = {
  onBack?: () => void;
};

export function AgentScreen({ onBack }: AgentScreenProps) {
  const [items, setItems] = useState<StreamItem[]>(INITIAL);
  const [killEngaged, setKillEngaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<StreamItem>>(null);
  const streamCleanup = useRef<(() => void) | null>(null);

  // Auto-scroll to the newest message whenever items change.
  useEffect(() => {
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [items]);

  // Clean up any in-flight stream on unmount.
  useEffect(() => () => streamCleanup.current?.(), []);

  /** Simulated agent reply — streams tokens, then a tool call, then a follow-up. */
  const respond = (userText: string) => {
    if (busy) return;
    setBusy(true);

    const reply =
      userText.toLowerCase().includes('summar') || userText.toLowerCase().includes('mail')
        ? 'Here\'s what\'s in your inbox: 12 unread, 3 need a reply. The top item is the Acme contract — reply by 5pm. Want me to draft a reply?'
        : userText.toLowerCase().includes('draft') || userText.toLowerCase().includes('reply')
          ? 'I can draft a reply to Acme: "Thanks for sending the contract — I have reviewed it and will return it signed by EOD." Want me to send it?'
          : userText.toLowerCase().includes('attention') || userText.toLowerCase().includes('follow')
            ? 'Two things need you: the Acme contract (reply by 5pm) and the vendor invoice (needs review). I can handle the follow-up on the proposal if you want.'
            : 'Got it. I\'ll take care of that and report back. Anything else you want me to handle?';

    const replyId = `a${Date.now()}`;
    const toolId = `t${Date.now()}`;

    // Stream the reply, then show a tool call, then a follow-up question.
    streamCleanup.current = streamReply(setItems, reply, replyId);
    setTimeout(() => {
      setItems((prev) => [
        ...prev,
        { type: 'tool', id: toolId, name: 'agent.act', args: `"${userText.slice(0, 24)}"`, latencyMs: 87, ok: true },
      ]);
      setTimeout(() => {
        setItems((prev) => [
          ...prev,
          { type: 'agent', id: `a${Date.now() + 1}`, text: 'Anything else?' },
        ]);
        setBusy(false);
      }, 900);
    }, reply.length * 24 + 400);
  };

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setItems((prev) => [...prev, { type: 'user', id: `u${Date.now()}`, text }]);
    respond(text);
  };

  const renderItem = ({ item }: { item: StreamItem }) => {
    switch (item.type) {
      case 'agent':
        return <AgentBubble text={item.text} streaming={item.streaming} showFeedback />;
      case 'user':
        return (
          <View style={styles.userBubble}>
            <Text style={styles.userText}>{item.text}</Text>
          </View>
        );
      case 'tool':
        return <ToolChip name={item.name} args={item.args} latencyMs={item.latencyMs} ok={item.ok} />;
      case 'escalation':
        return (
          <EscalationCard
            question={item.question}
            choices={[{ label: 'Yes', primary: true }, { label: 'No' }]}
            onChoose={() => {}}
          />
        );
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        {onBack ? (
          <Pressable accessibilityLabel="Back" onPress={onBack} style={styles.headerBtn}>
            <IconBack size={22} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
        <Text style={styles.headerTitle}>Agent</Text>
        <Pressable
          accessibilityLabel="Kill switch"
          onLongPress={() => setKillEngaged((k) => !k)}
          style={[styles.headerBtn, killEngaged && styles.killEngaged]}
        >
          <IconPower size={22} color={killEngaged ? colors.danger : colors.textMuted} />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => Keyboard.dismiss()}
        ListEmptyComponent={
          <EmptyState
            icon={<IconAgent size={48} color={colors.textSubtle} />}
            title="Ask the agent anything"
            body="Summarize today's mail, draft replies, follow up on what's waiting."
          />
        }
        ListFooterComponent={
          items.length === 0 ? null : (
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  accessibilityRole="button"
                  accessibilityLabel={s}
                  disabled={busy}
                  onPress={() => send(s)}
                  style={({ pressed }) => [
                    styles.suggestionChip,
                    busy && styles.suggestionChipDisabled,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.suggestionText}>{s}</Text>
                </Pressable>
              ))}
            </View>
          )
        }
      />

      <View style={styles.composerBar}>
        <Composer onSend={send} disabled={busy} disabledReason={busy ? 'Agent is working…' : undefined} />
      </View>
    </KeyboardAvoidingView>
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
  },
  headerBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  killEngaged: { backgroundColor: colors.dangerBg },
  headerTitle: { ...typography.h3, color: colors.text },
  listContent: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    borderTopRightRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userText: { ...typography.body, color: colors.textOnPrimary },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  suggestionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 40,
    justifyContent: 'center',
  },
  suggestionChipDisabled: { opacity: 0.4 },
  suggestionText: { ...typography.bodySmall, color: colors.textMuted },
  composerBar: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
