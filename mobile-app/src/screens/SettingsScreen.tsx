/**
 * Settings — the control room.
 * MVP-UI §4.5 · DB: Confirmation Dialogs (clear/remove/disconnect),
 * Submit Feedback (test connection), Empty States.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ConfirmDialog, EmptyState, SectionLabel } from '../components/ui';
import { Field, ProviderCard, SkillRow, type Provider, type Skill } from '../components/settings';
import { IconBack, IconPlus, IconSettings } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

const MOCK_PROVIDERS: Provider[] = [
  { id: 'p1', name: 'OpenRouter', model: 'gpt-4o-mini', primary: true, connected: true, keyMasked: '•••• 4f2a' },
];

const MOCK_SKILLS: Skill[] = [
  { id: 's1', name: 'Triage', trigger: 'Schedule 08:00', enabled: true },
  { id: 's2', name: 'Draft replies', trigger: 'On new mail', enabled: false },
  { id: 's3', name: 'Follow-ups', trigger: 'Manual', enabled: false, shadow: true },
];

export function SettingsScreen() {
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => void } | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [providerName, setProviderName] = useState('');
  const [providerUrl, setProviderUrl] = useState('');
  const [providerKey, setProviderKey] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [skillName, setSkillName] = useState('');
  const [skillInstruction, setSkillInstruction] = useState('');

  const clearMemory = () =>
    setConfirm({
      title: 'Clear memory?',
      body: 'This deletes all stored threads, facts, and preferences. This cannot be undone.',
      action: () => setConfirm(null),
    });

  const removeProvider = (id: string) =>
    setConfirm({
      title: 'Remove provider?',
      body: 'The API key will be deleted from this device.',
      action: () => setConfirm(null),
    });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SectionLabel>Email account</SectionLabel>
        <Card>
          <Text style={styles.cardTitle}>Gmail · langat@gmail.com</Text>
          <Text style={styles.cardStatus}>● Connected</Text>
          <View style={styles.cardActions}>
            <Button label="Test" variant="secondary" onPress={() => {}} />
            <Button label="Edit" variant="secondary" onPress={() => {}} />
          </View>
        </Card>

        <SectionLabel>AI providers</SectionLabel>
        {MOCK_PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p} onTest={() => {}} onRemove={removeProvider} />
        ))}
        <Button
          label="Add provider"
          variant="secondary"
          onPress={() => setShowAddProvider(true)}
          icon={<IconPlus size={18} color={colors.text} />}
        />

        <SectionLabel>Skills</SectionLabel>
        {MOCK_SKILLS.map((s) => (
          <SkillRow key={s.id} skill={s} onToggle={() => {}} onEdit={() => {}} />
        ))}
        <Button
          label="Add skill"
          variant="secondary"
          onPress={() => setShowAddSkill(true)}
          icon={<IconPlus size={18} color={colors.text} />}
        />

        <SectionLabel>Memory</SectionLabel>
        <Card>
          <Text style={styles.cardTitle}>128 entries · 2.4 MB</Text>
          <Button label="Clear" variant="danger" onPress={clearMemory} />
        </Card>

        <SectionLabel>Guardrails</SectionLabel>
        <Card>
          <Text style={styles.cardRow}>Kill switch · engaged</Text>
          <Text style={styles.cardRow}>Daily budget · $0.50 / day</Text>
          <Text style={styles.cardRow}>Quiet hours · 22:00 – 07:00</Text>
          <Text style={styles.cardRow}>Shadow mode · off</Text>
        </Card>

        <SectionLabel>About</SectionLabel>
        <Card>
          <Text style={styles.cardRow}>Version 0.1.0</Text>
          <Text style={styles.cardRow}>Open source · Privacy</Text>
        </Card>
      </ScrollView>

      {showAddProvider && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add provider</Text>
          <Field label="Name" value={providerName} onChangeText={setProviderName} placeholder="OpenRouter" />
          <Field label="Base URL" value={providerUrl} onChangeText={setProviderUrl} placeholder="https://openrouter.ai/api/v1" />
          <Field label="API key" value={providerKey} onChangeText={setProviderKey} secure placeholder="sk-…" />
          <Field label="Default model" value={providerModel} onChangeText={setProviderModel} placeholder="gpt-4o-mini" />
          <Button label="Test connection" variant="secondary" onPress={() => {}} />
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={() => setShowAddProvider(false)} />
            <Button label="Save" onPress={() => setShowAddProvider(false)} />
          </View>
        </View>
      )}

      {showAddSkill && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add skill</Text>
          <Field label="Name" value={skillName} onChangeText={setSkillName} placeholder="Triage" />
          <Field label="Instruction" value={skillInstruction} onChangeText={setSkillInstruction} placeholder="Clear the unread backlog each morning" />
          <Button label="Test connection" variant="secondary" onPress={() => {}} />
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={() => setShowAddSkill(false)} />
            <Button label="Save" onPress={() => setShowAddSkill(false)} />
          </View>
        </View>
      )}

      <ConfirmDialog
        visible={!!confirm}
        title={confirm?.title ?? ''}
        body={confirm?.body}
        confirmLabel="Confirm"
        destructive
        onConfirm={confirm?.action ?? (() => {})}
        onCancel={() => setConfirm(null)}
      />
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
  headerBtn: { width: touch.minTarget, height: touch.minTarget },
  headerTitle: { ...typography.h3, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  cardStatus: { ...typography.bodySmall, color: colors.success, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cardRow: { ...typography.bodySmall, color: colors.textMuted, paddingVertical: spacing.xs },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgDeep,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  sheetTitle: { ...typography.h3, color: colors.text },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
});
