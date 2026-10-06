/**
 * Mail — inbox list → thread view → compose.
 * MVP-UI §4.2 · DB: Empty States, Submit Feedback (send), Confirmation Messages.
 */
import React, { useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, EmptyState, Toast } from '../components/ui';
import { Composer, MailRow, ThreadMessage, type MailSummary, type ThreadMessage as ThreadMsg } from '../components/mail';
import { EscalationCard } from '../components/agent';
import { IconBack, IconMail, IconPower, IconSparkle } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

const MOCK_MAIL: MailSummary[] = [
  { id: '1', sender: 'Acme Corp', subject: 'Contract — Acme', preview: 'Attached the signed contract for…', time: '09:41', unread: true },
  { id: '2', sender: 'Vendor Inc', subject: 'Invoice #4821', preview: 'Please remit payment for the…', time: '08:15', unread: true },
  { id: '3', sender: 'GitHub', subject: '[ThreadMyMail] CI', preview: 'Build #1234 failed on main…', time: '07:02', unread: false },
  { id: '4', sender: 'Mom', subject: 'Re: Dinner', preview: 'Sounds great, see you at 7!', time: '06:30', unread: false },
];

const MOCK_THREAD: ThreadMsg[] = [
  {
    id: '1',
    sender: 'Acme Corp',
    email: 'legal@acme.com',
    time: '09:41',
    body: 'Attached the signed contract for the Q3 renewal. Please review and return.',
  },
];

type MailScreenProps = {
  onOpenAgent: () => void;
};

export function MailScreen({ onOpenAgent }: MailScreenProps) {
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [killEngaged, setKillEngaged] = useState(false);

  const openThread = (id: string) => {
    setSelectedId(id);
    setView('thread');
  };

  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  };

  const sendDraft = (text: string) => {
    setToast('Message sent');
    setTimeout(() => setToast(null), 2500);
    setView('list');
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
        {view === 'list' ? 'Inbox' : view === 'thread' ? 'Thread' : 'New message'}
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
        <FlatList
          data={MOCK_MAIL}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MailRow mail={item} onPress={openThread} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon={<IconMail size={48} color={colors.textSubtle} />}
              title="Nothing in your inbox"
              body="The agent will surface what needs you."
            />
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
          {MOCK_THREAD.map((m) => (
            <ThreadMessage key={m.id} msg={m} />
          ))}
          <EscalationCard
            question="I can draft a reply. Want me to?"
            choices={[{ label: 'Yes', primary: true }, { label: 'No' }]}
            onChoose={(c) => {
              if (c === 'Yes') {
                setView('compose');
              }
            }}
          />
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
        <Text style={styles.composeField}>To: acme@corp.com</Text>
        <Text style={styles.composeField}>Cc: (optional)</Text>
        <Text style={styles.composeField}>Subject: Re: Contract — Acme</Text>
        <View style={styles.composeDivider} />
        <Text style={styles.composeBody}>
          Hi Acme team,{'\n\n'}Thanks for sending the contract. I've reviewed it and…
        </Text>
        <Button label="Draft with agent" variant="accent" onPress={() => {}} icon={<IconSparkle size={18} color={colors.textOnAccent} />} />
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
  threadContent: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  composerBar: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  composeContent: { padding: spacing.lg, gap: spacing.lg },
  composeField: { ...typography.body, color: colors.textMuted },
  composeDivider: { height: 1, backgroundColor: colors.border },
  composeBody: { ...typography.body, color: colors.text, lineHeight: 24 },
});
