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

type MailScreenProps = {
  onOpenAgent: () => void;
  onOpenSettings: () => void;
};

export function MailScreen({ onOpenAgent, onOpenSettings }: MailScreenProps) {
  const [view, setView] = useState<'list' | 'thread' | 'compose'>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadMsg[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [killEngaged, setKillEngaged] = useState(false);

  const openThread = (id: string) => {
    setSelectedId(id);
    setThread(null);
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
          data={[] as MailSummary[]}
          keyExtractor={(m) => m.id}
          renderItem={({ item }) => <MailRow mail={item} onPress={openThread} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <EmptyState
              icon={<IconMail size={48} color={colors.textSubtle} />}
              title="No mail yet"
              body="Connect an email account in Settings and Millo will start triaging."
              action={
                <Button label="Open Settings" variant="secondary" onPress={onOpenSettings} />
              }
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
          {thread ? (
            <>
              {thread.map((m) => (
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
            </>
          ) : (
            <EmptyState
              icon={<IconMail size={48} color={colors.textSubtle} />}
              title="Thread unavailable"
              body="This thread could not be loaded."
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
});
