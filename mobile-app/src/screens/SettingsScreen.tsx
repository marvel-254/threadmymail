/**
 * Settings — the control room.
 * MVP-UI §4.5 · DB: Confirmation Dialogs (clear/remove/disconnect),
 * Submit Feedback (test connection), Empty States.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ConfirmDialog, EmptyState, SectionLabel } from '../components/ui';
import { Field } from '../components/settings';
import { CUSTOM_PROVIDER_ID, PROVIDER_PRESETS } from '../lib/providers';
import { IconPlus } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

export function SettingsScreen() {
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => void } | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [providerPresetId, setProviderPresetId] = useState(PROVIDER_PRESETS[0].id);
  const [providerUrl, setProviderUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [providerKey, setProviderKey] = useState('');
  const [providerModel, setProviderModel] = useState(PROVIDER_PRESETS[0].defaultModel);
  const [skillName, setSkillName] = useState('');
  const [skillInstruction, setSkillInstruction] = useState('');

  const providerPreset = PROVIDER_PRESETS.find((p) => p.id === providerPresetId);

  /** Prefill the endpoint and model for a preset; Custom clears both. */
  const selectPreset = (id: string) => {
    setProviderPresetId(id);
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    setProviderUrl(preset?.baseUrl ?? '');
    setProviderModel(preset?.defaultModel ?? '');
  };

  const clearMemory = () =>
    setConfirm({
      title: 'Clear memory?',
      body: 'This deletes all stored threads, facts, and preferences. This cannot be undone.',
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
          <Text style={styles.cardTitle}>No account connected</Text>
          <Text style={styles.cardStatus}>Millo needs an email account to work.</Text>
          <View style={styles.cardActions}>
            <Button label="Connect" variant="secondary" onPress={() => {}} />
          </View>
        </Card>

        <SectionLabel>AI providers</SectionLabel>
        <EmptyState
          title="No AI providers yet"
          body="Add a provider so Millo can think. Your key stays on this device."
        />
        <Button
          label="Add provider"
          variant="secondary"
          onPress={() => setShowAddProvider(true)}
          icon={<IconPlus size={18} color={colors.text} />}
        />

        <SectionLabel>Skills</SectionLabel>
        <EmptyState
          title="No skills yet"
          body="A skill is a standing instruction Millo runs on a schedule."
        />
        <Button
          label="Add skill"
          variant="secondary"
          onPress={() => setShowAddSkill(true)}
          icon={<IconPlus size={18} color={colors.text} />}
        />

        <SectionLabel>Memory</SectionLabel>
        <Card>
          <Text style={styles.cardTitle}>No memory yet</Text>
          <Text style={styles.cardStatus}>0 entries</Text>
          <View style={styles.cardActions}>
            <Button label="Clear" variant="danger" disabled onPress={clearMemory} />
          </View>
        </Card>

        <SectionLabel>Guardrails</SectionLabel>
        <Card>
          <Text style={styles.cardRow}>Kill switch · off</Text>
          <Text style={styles.cardRow}>Daily budget · not set</Text>
          <Text style={styles.cardRow}>Quiet hours · not set</Text>
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
          <View style={styles.sheetPicker}>
            {PROVIDER_PRESETS.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityState={{ selected: p.id === providerPresetId }}
                onPress={() => selectPreset(p.id)}
                style={({ pressed }) => [
                  styles.sheetPickerItem,
                  p.id === providerPresetId && styles.sheetPickerItemActive,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text
                  style={[
                    styles.sheetPickerText,
                    p.id === providerPresetId && styles.sheetPickerTextActive,
                  ]}
                >
                  {p.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            label="API key"
            value={providerKey}
            onChangeText={setProviderKey}
            secure
            placeholder={providerPreset?.keyHint ?? 'sk-…'}
          />
          <Field
            label="Base URL"
            value={providerUrl}
            onChangeText={setProviderUrl}
            placeholder={providerPreset?.baseUrl || 'https://your-endpoint.example/v1'}
            helper={
              providerPresetId === CUSTOM_PROVIDER_ID
                ? 'Required — where the requests go.'
                : 'Prefilled. Change it if you use a proxy.'
            }
          />
          <Field
            label="Default model"
            value={providerModel}
            onChangeText={setProviderModel}
            placeholder={providerPreset?.defaultModel || 'model-id'}
          />
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
  sheetPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  sheetPickerItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 40,
    justifyContent: 'center',
  },
  sheetPickerItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  sheetPickerText: { ...typography.bodySmall, color: colors.textMuted },
  sheetPickerTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
});
