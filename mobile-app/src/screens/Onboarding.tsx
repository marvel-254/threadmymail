/**
 * Onboarding — Welcome → Connect email → Add AI key → Pick skills → Done.
 *
 * Every step writes to real stores so the user can quit at any point and return
 * where they left off. The "Test connection" buttons call live endpoints and
 * surface readable errors, not raw exceptions.
 */
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Button } from '../components/ui';
import { Field } from '../components/settings';
import { IconBack } from '../components/Icons';
import { PROVIDER_PRESETS, CUSTOM_PROVIDER_ID } from '../lib/providers';
import {
  EMAIL_PROVIDERS,
  saveAccount,
} from '../lib/accountStore';
import { addProvider } from '../lib/providerStore';
import {
  DEFAULT_SKILLS,
  SKILL_DEFINITIONS,
  loadSkills,
  saveSkills,
  type Skills,
} from '../lib/skillsStore';
import { testImap } from '../lib/emailTest';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';

const TOTAL_STEPS = 4; // welcome, email, AI key, skills

type OnboardingProps = {
  onDone: () => void;
};

export function Onboarding({ onDone }: OnboardingProps) {
  // ── Navigation ──────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);

  // ── Welcome video ───────────────────────────────────────────────────────
  const videoPlayer = useVideoPlayer(require('../assets/intro.mp4'), (player) => {
    player.loop = true;
    player.muted = true;
    player.play();
  });

  const next = () => {
    if (step === 3) {
      void finish();
    } else {
      setStep(step + 1);
    }
  };
  const back = () => (step > 0 ? setStep(step - 1) : undefined);

  // ── Email state ──────────────────────────────────────────────────────────
  const [emailProviderId, setEmailProviderId] = useState<string>(EMAIL_PROVIDERS[0].id);
  const [emailAddress, setEmailAddress] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [customImapHost, setCustomImapHost] = useState('');
  const [customImapPort, setCustomImapPort] = useState('993');
  const [customSmtpHost, setCustomSmtpHost] = useState('');
  const [customSmtpPort, setCustomSmtpPort] = useState('587');
  const [emailTesting, setEmailTesting] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);

  const selectedEmailProvider = EMAIL_PROVIDERS.find((p) => p.id === emailProviderId)!;

  const runEmailTest = async () => {
    setEmailTesting(true);
    setEmailResult(null);
    try {
      const result = await testImap({
        imap: {
          host: emailProviderId === 'custom' ? customImapHost.trim() : selectedEmailProvider.imapHost,
          port: emailProviderId === 'custom'
            ? Number(customImapPort) || 993
            : selectedEmailProvider.imapPort,
          security: selectedEmailProvider.imapSecurity,
        },
        smtp: emailProviderId === 'custom'
          ? { host: customSmtpHost.trim(), port: Number(customSmtpPort) || 587, security: 'starttls' }
          : { host: selectedEmailProvider.smtpHost, port: selectedEmailProvider.smtpPort, security: selectedEmailProvider.smtpSecurity },
        user: emailAddress,
        password: appPassword,
      });
      setEmailResult(result);
    } finally {
      setEmailTesting(false);
    }
  };

  const runEmailSave = async () => {
    if (!emailAddress.trim() || !appPassword) return;
    setEmailSaving(true);
    try {
      await saveAccount({
        providerId: emailProviderId,
        email: emailAddress,
        password: appPassword,
        customImapHost: emailProviderId === 'custom' ? customImapHost.trim() : undefined,
        customImapPort: emailProviderId === 'custom' ? Number(customImapPort) : undefined,
        customSmtpHost: emailProviderId === 'custom' ? customSmtpHost.trim() : undefined,
        customSmtpPort: emailProviderId === 'custom' ? Number(customSmtpPort) : undefined,
      });
      next();
    } catch (err) {
      setEmailResult({ ok: false, detail: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setEmailSaving(false);
    }
  };

  // ── AI state ────────────────────────────────────────────────────────────
  const [aiPresetId, setAiPresetId] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [model, setModel] = useState(PROVIDER_PRESETS[0].defaultModel);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiResult, setAiResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [aiSaving, setAiSaving] = useState(false);

  const aiPreset = PROVIDER_PRESETS.find((p) => p.id === aiPresetId) ?? PROVIDER_PRESETS[0];

  const selectAiPreset = (id: string) => {
    setAiPresetId(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    setBaseUrl(p?.baseUrl ?? '');
    setModel(p?.defaultModel ?? '');
  };

  const runAiTest = async () => {
    const local = aiPresetId === 'local';
    if (!apiKey.trim() && !local) {
      setAiResult({ ok: false, detail: 'Paste your API key first.' });
      return;
    }
    if (!baseUrl.trim()) {
      setAiResult({ ok: false, detail: 'Set a base URL first.' });
      return;
    }
    setAiTesting(true);
    setAiResult(null);
    try {
      const { testProvider } = await import('../lib/providerStore');
      const result = await testProvider({ baseUrl, apiKey, model, id: aiPresetId });
      setAiResult(result);
    } finally {
      setAiTesting(false);
    }
  };

  const runAiSave = async () => {
    const local = aiPresetId === 'local';
    if (!apiKey.trim() && !local) {
      setAiResult({ ok: false, detail: 'Paste your API key first.' });
      return;
    }
    if (!baseUrl.trim()) {
      setAiResult({ ok: false, detail: 'Set a base URL first.' });
      return;
    }
    setAiSaving(true);
    try {
      await addProvider({
        id: aiPresetId,
        label: aiPreset.label,
        baseUrl,
        model,
        apiKey,
      });
      next();
    } catch (err) {
      setAiResult({ ok: false, detail: err instanceof Error ? err.message : 'Could not save.' });
    } finally {
      setAiSaving(false);
    }
  };

  // ── Skills state ────────────────────────────────────────────────────────
  const [skills, setSkills] = useState<Skills>({ ...DEFAULT_SKILLS });

  useEffect(() => {
    let cancelled = false;
    void loadSkills().then((saved) => {
      if (!cancelled) setSkills(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = async () => {
    try {
      await saveSkills(skills);
    } finally {
      onDone();
    }
  };

  // ── Shared helpers ──────────────────────────────────────────────────────
  const ResultBanner = ({ result }: { result: { ok: boolean; detail: string } | null }) => {
    if (!result) return null;
    return (
      <View style={[styles.resultBanner, result.ok ? styles.resultOk : styles.resultErr]}>
        <Text style={[styles.resultText, result.ok ? styles.resultTextOk : styles.resultTextErr]}>
          {result.detail}
        </Text>
      </View>
    );
  };

  const Picker = <T extends string>({
    options,
    selected,
    onSelect,
    label,
  }: {
    options: readonly T[];
    selected: T;
    onSelect: (v: T) => void;
    label?: string;
  }) => (
    <View style={styles.pickerGroup}>
      {label && <Text style={styles.pickerLabel}>{label}</Text>}
      <View style={styles.picker}>
        {options.map((o) => (
          <Pressable
            key={o}
            accessibilityRole="button"
            accessibilityState={{ selected: o === selected }}
            onPress={() => onSelect(o)}
            style={[styles.pickerItem, o === selected && styles.pickerItemActive]}
          >
            <Text style={[styles.pickerText, o === selected && styles.pickerTextActive]}>
              {o}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      {/* ── Header bar ─────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerBtn}>
          {step > 0 ? (
            <Pressable accessibilityLabel="Back" onPress={back} style={styles.headerBtnInner}>
              <IconBack size={22} color={colors.text} />
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.stepCount}>{step + 1} / {TOTAL_STEPS}</Text>
        <Pressable accessibilityLabel="Skip all setup" onPress={onDone} style={styles.headerBtnInner}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      </View>

      {/* ── Step content ──────────────────────────────────────────── */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* ── Step 0: Welcome ─────────────────────────────────────── */}
        {step === 0 && (
          <View style={styles.welcome}>
            <View style={styles.heroCard}>
              <View style={styles.videoContainer}>
                <VideoView
                  player={videoPlayer}
                  style={styles.video}
                  nativeControls={false}
                  contentFit="cover"
                />
              </View>
              <Text style={styles.heroKicker}>MILLO</Text>
              <Text style={styles.welcomeTitle}>Your inbox, run by an agent you control.</Text>
              <Text style={styles.welcomeBody}>
                Credentials and AI key stay on this phone. Triage, drafts, and follow-ups — on your schedule.
              </Text>
            </View>
          </View>
        )}

        {/* ── Step 1: Email account ───────────────────────────────── */}
        {step === 1 && (
          <>
            <Text style={styles.stepTitle}>Connect email</Text>
            <Picker
              label="Provider"
              options={EMAIL_PROVIDERS.map((p) => p.label) as unknown as readonly string[]}
              selected={selectedEmailProvider.label}
              onSelect={(label) => {
                const p = EMAIL_PROVIDERS.find((x) => x.label === label);
                if (p) setEmailProviderId(p.id);
              }}
            />
            <Field
              label="Email address"
              value={emailAddress}
              onChangeText={(t) => { setEmailAddress(t); setEmailResult(null); }}
              placeholder="you@example.com"
              keyboardType="email-address"
            />
            <Field
              label="App password"
              value={appPassword}
              onChangeText={(t) => { setAppPassword(t); setEmailResult(null); }}
              secure
              placeholder="•••• •••• •••• ••••"
              helper={
                emailProviderId === 'gmail'
                  ? 'Create one at myaccount.google.com → Security → 2-Step → App passwords.'
                  : emailProviderId === 'outlook'
                    ? 'Create one at account.microsoft.com → Security → App passwords.'
                    : 'Use the app-password or integration password for your provider.'
              }
            />
            {emailProviderId === 'custom' && (
              <>
                <Field label="IMAP host" value={customImapHost} onChangeText={setCustomImapHost} placeholder="imap.example.com" />
                <Field label="IMAP port" value={customImapPort} onChangeText={setCustomImapPort} keyboardType="numeric" />
                <Field label="SMTP host" value={customSmtpHost} onChangeText={setCustomSmtpHost} placeholder="smtp.example.com" />
                <Field label="SMTP port" value={customSmtpPort} onChangeText={setCustomSmtpPort} keyboardType="numeric" />
              </>
            )}
            <ResultBanner result={emailResult} />
          </>
        )}

        {/* ── Step 2: AI key ──────────────────────────────────────── */}
        {step === 2 && (
          <>
            <Text style={styles.stepTitle}>Add AI key</Text>
            <Picker
              label="Provider"
              options={PROVIDER_PRESETS.map((p) => p.label) as unknown as readonly string[]}
              selected={aiPreset.label}
              onSelect={(label) => {
                const p = PROVIDER_PRESETS.find((x) => x.label === label);
                if (p) selectAiPreset(p.id);
              }}
            />
            <Field
              label="API key"
              value={apiKey}
              onChangeText={(t) => { setApiKey(t); setAiResult(null); }}
              secure
              placeholder={aiPreset.keyHint}
            />
            <Field
              label="Base URL"
              value={baseUrl}
              onChangeText={setBaseUrl}
              placeholder="https://api.openai.com/v1"
              helper={
                aiPresetId === CUSTOM_PROVIDER_ID
                  ? 'Required. Must be an OpenAI-compatible endpoint.'
                  : 'Prefilled for this provider. Change it if you use a proxy.'
              }
            />
            <Field
              label="Default model"
              value={model}
              onChangeText={setModel}
              placeholder="gpt-4o-mini"
              helper="Used unless a skill specifies a different one."
            />
            <ResultBanner result={aiResult} />
          </>
        )}

        {/* ── Step 3: Skills ──────────────────────────────────────── */}
        {step === 3 && (
          <>
            <Text style={styles.stepTitle}>Pick skills</Text>
            <Text style={styles.stepBody}>
              Optional — all of these can be changed later in Settings.
            </Text>
            {SKILL_DEFINITIONS.map((skill) => (
              <View key={skill.id} style={styles.skillRow}>
                <View style={styles.skillCopy}>
                  <Text style={styles.skillName}>{skill.label}</Text>
                  <Text style={styles.skillDescription}>{skill.description}</Text>
                </View>
                <Switch
                  value={skills[skill.id]}
                  onValueChange={(v) => setSkills((prev) => ({ ...prev, [skill.id]: v }))}
                  trackColor={{ false: colors.bgSurfaceHover, true: colors.primary }}
                  thumbColor={colors.textOnPrimary}
                />
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* ── Footer CTA ───────────────────────────────────────────── */}
      <View style={styles.footer}>
        {/* Step 1: email — two buttons: Test (secondary) and Save & continue (primary) */}
        {step === 1 && (
          <View style={styles.footerRow}>
            <Button
              label={emailTesting ? 'Testing…' : 'Test connection'}
              variant="secondary"
              disabled={emailTesting || !emailAddress.trim() || !appPassword}
              loading={emailTesting}
              onPress={runEmailTest}
            />
            <Button
              label={emailSaving ? 'Saving…' : 'Save & continue'}
              disabled={emailSaving || !emailAddress.trim() || !appPassword}
              loading={emailSaving}
              onPress={runEmailSave}
            />
          </View>
        )}
        {/* Step 2: AI — two buttons: Test (secondary) and Save & continue (primary) */}
        {step === 2 && (
          <View style={styles.footerRow}>
            <Button
              label={aiTesting ? 'Testing…' : 'Test connection'}
              variant="secondary"
              disabled={aiTesting || (!apiKey.trim() && aiPresetId !== 'local')}
              loading={aiTesting}
              onPress={runAiTest}
            />
            <Button
              label={aiSaving ? 'Saving…' : 'Save & continue'}
              disabled={aiSaving || (!apiKey.trim() && aiPresetId !== 'local') || !baseUrl.trim()}
              loading={aiSaving}
              onPress={runAiSave}
            />
          </View>
        )}
        {/* Steps 0 and 3: single Continue button */}
        {step !== 1 && step !== 2 && (
          <Button label={step === 3 ? 'Done' : step === 0 ? 'Get started' : 'Continue'} onPress={next} fullWidth />
        )}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    minHeight: 56,
  },
  headerBtn: { width: touch.minTarget, height: touch.minTarget },
  headerBtnInner: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCount: { ...typography.caption, color: colors.textSubtle },
  skipText: { ...typography.bodySmall, color: colors.primaryText, fontWeight: '600' },
  content: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxl * 2 },
  welcome: { alignItems: 'stretch', gap: spacing.md, paddingTop: spacing.sm },
  heroCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.md,
    overflow: 'hidden',
  },
  videoContainer: {
    width: '100%',
    height: 220,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.secondary,
  },
  video: {
    width: '100%',
    height: '100%',
  },
  heroKicker: {
    ...typography.label,
    color: colors.primary,
  },
  welcomeTitle: { ...typography.h1, color: colors.text, textAlign: 'left' },
  welcomeBody: { ...typography.body, color: colors.textMuted, textAlign: 'left' },
  stepTitle: { ...typography.h2, color: colors.text },
  stepBody: { ...typography.bodySmall, color: colors.textMuted },
  pickerGroup: { gap: spacing.sm },
  pickerLabel: { ...typography.label, color: colors.textMuted },
  picker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerItem: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: touch.minTarget,
    justifyContent: 'center',
  },
  pickerItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickerText: { ...typography.bodySmall, color: colors.textMuted },
  pickerTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  resultBanner: {
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
  },
  resultOk: { backgroundColor: colors.successBg, borderColor: colors.success },
  resultErr: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  resultText: { ...typography.bodySmall },
  resultTextOk: { color: colors.successText },
  resultTextErr: { color: colors.dangerText },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgSurface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  skillCopy: { flex: 1, gap: 2 },
  skillName: { ...typography.body, color: colors.text, fontWeight: '600' },
  skillDescription: { ...typography.caption, color: colors.textMuted },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  footerRow: { flexDirection: 'row', gap: spacing.md },
}));
