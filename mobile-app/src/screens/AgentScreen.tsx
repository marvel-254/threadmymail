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
  | { type: 'escalation'; id: string; question: string }
  | { type: 'notice'; id: string; text: string };

type AgentScreenProps = {
  onBack?: () => void;
};

export function AgentScreen({ onBack }: AgentScreenProps) {
  const [items, setItems] = useState<StreamItem[]>([]);
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

  const send = (text: string) => {
    if (!text.trim() || busy) return;
    setItems((prev) => [...prev, { type: 'user', id: `u${Date.now()}`, text }]);
    setItems((prev) => [
      ...prev,
      {
        type: 'notice',
        id: `n${Date.now()}`,
        text: 'No AI provider is connected. Add one in Settings.',
      },
    ]);
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
      case 'notice':
        return (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{item.text}</Text>
          </View>
        );
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
            title="No conversation yet"
            body="Send a message to get started. Millo will reply once an AI provider is connected."
          />
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
  notice: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeText: { ...typography.bodySmall, color: colors.textMuted },
  composerBar: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
