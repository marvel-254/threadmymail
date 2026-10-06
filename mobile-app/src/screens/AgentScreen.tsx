/**
 * Agent — the live conversation stream (the heart of the product).
 * MVP-UI §4.3 · DB: Streaming (token-by-token), Disclaimer (AI label),
 * Feedback Loop (thumbs), Typing indicators, Empty States.
 */
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { AgentBubble, EscalationCard, ToolChip } from '../components/agent';
import { Composer } from '../components/mail';
import { EmptyState } from '../components/ui';
import { IconAgent, IconBack, IconPower, IconSparkle } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

type StreamItem =
  | { type: 'agent'; id: string; text: string; streaming?: boolean }
  | { type: 'tool'; id: string; name: string; args: string; latencyMs: number; ok: boolean }
  | { type: 'escalation'; id: string; question: string };

const INITIAL: StreamItem[] = [
  { type: 'agent', id: 'a1', text: 'I found 3 threads waiting on you. Top: Acme contract — reply by 5pm.' },
  { type: 'tool', id: 't1', name: 'imap.search', args: '"from:acme"', latencyMs: 42, ok: true },
  { type: 'tool', id: 't2', name: 'memory.recall', args: '"acme contract"', latencyMs: 18, ok: true },
  { type: 'agent', id: 'a2', text: 'Want me to draft a reply?' },
  { type: 'escalation', id: 'e1', question: 'I can draft a reply. Want me to?' },
];

type AgentScreenProps = {
  onBack?: () => void;
};

export function AgentScreen({ onBack }: AgentScreenProps) {
  const [items, setItems] = useState<StreamItem[]>(INITIAL);
  const [killEngaged, setKillEngaged] = useState(false);
  const listRef = useRef<FlatList<StreamItem>>(null);

  useEffect(() => {
    // Simulate a streaming response on mount.
    const t = setTimeout(() => {
      setItems((prev) => [
        ...prev,
        { type: 'agent', id: 'a3', text: 'Drafting now…', streaming: true },
      ]);
      setTimeout(() => {
        setItems((prev) =>
          prev.map((i) => (i.id === 'a3' ? { ...i, text: 'Here is a draft reply for Acme: "Thanks for sending the contract — I have reviewed it and will return it signed by EOD."', streaming: false } : i)),
        );
      }, 1200);
    }, 800);
    return () => clearTimeout(t);
  }, []);

  const send = (text: string) => {
    setItems((prev) => [...prev, { type: 'agent', id: `u${Date.now()}`, text }]);
  };

  return (
    <View style={styles.screen}>
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
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        renderItem={({ item }) => {
          switch (item.type) {
            case 'agent':
              return <AgentBubble text={item.text} streaming={item.streaming} showFeedback />;
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
        }}
        ListEmptyComponent={
          <EmptyState
            icon={<IconAgent size={48} color={colors.textSubtle} />}
            title="Ask the agent anything"
            body="Summarize today's mail, draft replies, follow up on what's waiting."
          />
        }
      />

      <View style={styles.composerBar}>
        <Composer onSend={send} />
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
  composerBar: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
