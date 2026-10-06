/**
 * Onboarding — Welcome → Connect email → Add AI key → Pick skills → Done.
 * MVP-UI §3 · DB: User Freedom (Skip + Back), Empty States, Submit Feedback.
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, SectionLabel } from '../components/ui';
import { Field } from '../components/settings';
import { IconBack, IconSparkle } from '../components/Icons';
import { CUSTOM_PROVIDER_ID, PROVIDER_PRESETS } from '../lib/providers';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

const PROVIDERS = ['Gmail', 'Outlook', 'Yahoo', 'iCloud', 'Custom'];
const SKILLS = ['Triage', 'Draft replies', 'Follow-ups'];

type OnboardingProps = {
  onDone: () => void;
};

export function Onboarding({ onDone }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [emailProvider, setEmailProvider] = useState('Gmail');
  const [email, setEmail] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [aiPresetId, setAiPresetId] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [model, setModel] = useState(PROVIDER_PRESETS[0].defaultModel);
  const [skills, setSkills] = useState<Record<string, boolean>>({ Triage: true, 'Draft replies': false, 'Follow-ups': false });

  const aiPreset = PROVIDER_PRESETS.find((p) => p.id === aiPresetId);

  /**
   * Selecting a preset prefills its endpoint and model. Custom has neither, so
   * both fields are cleared and the user must supply the base URL themselves —
   * that is the whole reason Custom exists.
   */
  const selectAiPreset = (id: string) => {
    setAiPresetId(id);
    const preset = PROVIDER_PRESETS.find((p) => p.id === id);
    setBaseUrl(preset?.baseUrl ?? '');
    setModel(preset?.defaultModel ?? '');
  };

  const next = () => (step < 4 ? setStep(step + 1) : onDone());
  const back = () => (step > 0 ? setStep(step - 1) : undefined);

  const picker = (options: string[], selected: string, onSelect: (v: string) => void) => (
    <View style={styles.picker}>
      {options.map((o) => (
        <Pressable
          key={o}
          accessibilityRole="button"
          accessibilityState={{ selected: o === selected }}
          onPress={() => onSelect(o)}
          style={[styles.pickerItem, o === selected && styles.pickerItemActive]}
        >
          <Text style={[styles.pickerText, o === selected && styles.pickerTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {step > 0 ? (
          <Pressable accessibilityLabel="Back" onPress={back} style={styles.headerBtn}>
            <IconBack size={22} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerBtn} />
        )}
        <Text style={styles.stepCount}>{step + 1} / 5</Text>
        <Pressable accessibilityLabel="Skip" onPress={onDone} style={styles.headerBtn}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === 0 && (
          <View style={styles.welcome}>
            <View style={styles.logo}>
              <IconSparkle size={32} color={colors.primary} />
            </View>
            <Text style={styles.welcomeTitle}>Your inbox, run by an agent you control</Text>
            <Text style={styles.welcomeBody}>
              Your credentials and keys never leave this phone.
            </Text>
          </View>
        )}

        {step === 1 && (
          <>
            <Text style={styles.stepTitle}>Connect email</Text>
            {picker(PROVIDERS, emailProvider, setEmailProvider)}
            {emailProvider === 'Custom' && (
              <>
                <Field label="IMAP host" value={email} onChangeText={setEmail} placeholder="imap.example.com" />
                <Field label="SMTP host" value={appPassword} onChangeText={setAppPassword} placeholder="smtp.example.com" />
              </>
            )}
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" />
            <Field label="App password" value={appPassword} onChangeText={setAppPassword} secure placeholder="•••• •••• •••• ••••" />
            <Button label="Test connection" variant="secondary" onPress={() => {}} />
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>Add AI key</Text>
            {picker(
              PROVIDER_PRESETS.map((p) => p.label),
              aiPreset?.label ?? '',
              (label) => {
                const preset = PROVIDER_PRESETS.find((p) => p.label === label);
                if (preset) selectAiPreset(preset.id);
              },
            )}
            <Field
              label="API key"
              value={apiKey}
              onChangeText={setApiKey}
              secure
              placeholder={aiPreset?.keyHint ?? 'sk-…'}
              helper={
                aiPresetId === CUSTOM_PROVIDER_ID
                  ? 'Any OpenAI-compatible endpoint works.'
                  : aiPreset?.keyHint
                    ? `Expected a key starting with ${aiPreset.keyHint}`
                    : undefined
              }
            />
            <Field
              label="Base URL"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder={aiPreset?.baseUrl || 'https://your-endpoint.example/v1'}
              helper={
                aiPresetId === CUSTOM_PROVIDER_ID
                  ? 'Required for a custom provider — where the requests go.'
                  : 'Prefilled for this provider. Change it if you use a proxy.'
              }
            />
            <Field
              label="Default model"
              value={model}
              onChangeText={setModel}
              placeholder={aiPreset?.defaultModel || 'model-id'}
              helper="Which model the agent uses unless a skill overrides it."
            />
            <Button label="Test connection" variant="secondary" onPress={() => {}} />
          </>
        )}

        {step === 3 && (
          <>
            <Text style={styles.stepTitle}>Pick skills</Text>
            <Text style={styles.stepBody}>Optional — configure later in Settings.</Text>
            {SKILLS.map((s) => (
              <View key={s} style={styles.skillRow}>
                <Text style={styles.skillName}>{s}</Text>
                <Switch
                  value={skills[s]}
                  onValueChange={(v) => setSkills((prev) => ({ ...prev, [s]: v }))}
                  trackColor={{ false: colors.surfaceStrong, true: colors.primary }}
                  thumbColor={colors.textOnPrimary}
                />
              </View>
            ))}
          </>
        )}

        {step === 4 && (
          <View style={styles.welcome}>
            <Text style={styles.welcomeTitle}>You're all set</Text>
            <Text style={styles.welcomeBody}>The agent will start with your morning triage.</Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button label={step === 4 ? 'Done' : 'Continue'} onPress={next} fullWidth />
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
  stepCount: { ...typography.caption, color: colors.textSubtle },
  skipText: { ...typography.bodySmall, color: colors.accent, fontWeight: '600' },
  content: { padding: spacing.xl, gap: spacing.lg },
  welcome: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xxl },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeTitle: { ...typography.h1, color: colors.text, textAlign: 'center' },
  welcomeBody: { ...typography.body, color: colors.textMuted, textAlign: 'center' },
  stepTitle: { ...typography.h2, color: colors.text },
  stepBody: { ...typography.bodySmall, color: colors.textMuted },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: touch.minTarget,
    justifyContent: 'center',
  },
  pickerItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickerText: { ...typography.bodySmall, color: colors.textMuted },
  pickerTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  skillName: { ...typography.body, color: colors.text, fontWeight: '600' },
  footer: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
});
