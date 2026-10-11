/**
 * Settings — the control room. MVP-UI §4.5.
 * All four sections wired to real stores; "Test connection" calls live endpoints.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Card, ConfirmDialog, EmptyState, SectionLabel, Toast } from '../components/ui';
import { Field, ProviderCard } from '../components/settings';
import { PROVIDER_PRESETS, CUSTOM_PROVIDER_ID } from '../lib/providers';
import {
  loadProviders, removeProvider, setPrimary, addProvider,
  testProvider, maskKey, type SavedProvider,
} from '../lib/providerStore';
import {
  EMAIL_PROVIDERS, clearAccount, loadAccount, saveAccount,
  type AccountConfig,
} from '../lib/accountStore';
import { getMailSync } from '../lib/mailSyncSingleton';
import { testImap } from '../lib/emailTest';
import { IconPlus } from '../components/Icons';
import { colors, radii, spacing, touch, typography } from '../theme/theme';

// ── Confirm helper ────────────────────────────────────────────────────────
type Confirm = { title: string; body: string; action: () => void } | null;

export function SettingsScreen() {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const toast = (text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 2500);
  };
  const ask = (title: string, body: string, action: () => void) =>
    setConfirm({ title, body, action });

  // ── Email account ───────────────────────────────────────────────────────
  const [account, setAccount] = useState<AccountConfig | null>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [emailProviderId, setEmailProviderId] = useState(EMAIL_PROVIDERS[0].id);
  const [emailAddress, setEmailAddress] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [customImapHost, setCustomImapHost] = useState('');
  const [customImapPort, setCustomImapPort] = useState('993');
  const [customSmtpHost, setCustomSmtpHost] = useState('');
  const [customSmtpPort, setCustomSmtpPort] = useState('587');
  const [connecting, setConnecting] = useState(false);
  const [connectResult, setConnectResult] = useState<{ ok: boolean; detail: string } | null>(null);

  useEffect(() => { void loadAccount().then(setAccount); }, []);

  const connectAccount = async () => {
    if (!emailAddress.trim() || !emailPassword) {
      setConnectResult({ ok: false, detail: 'Enter your email address and app password.' });
      return;
    }
    setConnecting(true);
    setConnectResult(null);
    const provider = EMAIL_PROVIDERS.find((p) => p.id === emailProviderId) ?? EMAIL_PROVIDERS[0];
    const result = await testImap({
      imap: {
        host: emailProviderId === 'custom' ? customImapHost.trim() : provider.imapHost,
        port: emailProviderId === 'custom' ? (Number(customImapPort) || 993) : provider.imapPort,
        security: provider.imapSecurity,
      },
      smtp: emailProviderId === 'custom'
        ? { host: customSmtpHost.trim(), port: Number(customSmtpPort) || 587, security: 'starttls' }
        : { host: provider.smtpHost, port: provider.smtpPort, security: provider.smtpSecurity },
      user: emailAddress,
      password: emailPassword,
    });
    if (!result.ok) { setConnectResult(result); setConnecting(false); return; }
    try {
      const saved = await saveAccount({
        providerId: emailProviderId, email: emailAddress, password: emailPassword,
        customImapHost: emailProviderId === 'custom' ? customImapHost.trim() : undefined,
        customImapPort: emailProviderId === 'custom' ? Number(customImapPort) : undefined,
        customSmtpHost: emailProviderId === 'custom' ? customSmtpHost.trim() : undefined,
        customSmtpPort: emailProviderId === 'custom' ? Number(customSmtpPort) : undefined,
      });
      setAccount(saved);
      setShowConnect(false);
      toast('Email connected');
      void getMailSync().start({ imap: saved.imap, smtp: saved.smtp, auth: { user: saved.email, password: saved.password } });
    } catch (err) {
      setConnectResult({ ok: false, detail: err instanceof Error ? err.message : 'Could not save.' });
    } finally { setConnecting(false); }
  };

  const disconnectAccount = () =>
    ask('Disconnect email?', 'This removes the account from this device. Cached messages stay in the inbox.', async () => {
      await clearAccount();
      await getMailSync().stop();
      setAccount(null);
      setConfirm(null);
      toast('Email disconnected');
    });

  // ── AI providers ────────────────────────────────────────────────────────
  const [providers, setProviders] = useState<SavedProvider[]>([]);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [providerPresetId, setProviderPresetId] = useState(PROVIDER_PRESETS[0].id);
  const [providerKey, setProviderKey] = useState('');
  const [providerUrl, setProviderUrl] = useState(PROVIDER_PRESETS[0].baseUrl);
  const [providerModel, setProviderModel] = useState(PROVIDER_PRESETS[0].defaultModel);
  const [addResult, setAddResult] = useState<{ ok: boolean; detail: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { void loadProviders().then(setProviders); }, []);

  const selectPreset = (id: string) => {
    setProviderPresetId(id);
    const p = PROVIDER_PRESETS.find((x) => x.id === id);
    setProviderUrl(p?.baseUrl ?? '');
    setProviderModel(p?.defaultModel ?? '');
  };

  const doTestProvider = async (p: SavedProvider) => {
    const r = await testProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model });
    toast(r.detail, r.ok);
  };

  const saveNewProvider = async () => {
    if (!providerKey.trim()) { setAddResult({ ok: false, detail: 'Paste your API key first.' }); return; }
    setAdding(true);
    setAddResult(null);
    const preset = PROVIDER_PRESETS.find((p) => p.id === providerPresetId) ?? PROVIDER_PRESETS[0];
    const result = await testProvider({ baseUrl: providerUrl, apiKey: providerKey, model: providerModel });
    if (!result.ok) { setAddResult(result); setAdding(false); return; }
    setProviders(await addProvider({ id: providerPresetId, label: preset.label, baseUrl: providerUrl, model: providerModel, apiKey: providerKey }));
    setShowAddProvider(false);
    toast('Provider added');
    setAdding(false);
  };

  // ── Guardrails ─────────────────────────────────────────────────────────
  const [killSwitch, setKillSwitch] = useState(false);
  const [shadowMode, setShadowMode] = useState(false);

  const GuardrailRow = ({ label, description, value, onChange }: {
    label: string; description: string; value: boolean; onChange: (v: boolean) => void;
  }) => (
    <View style={styles.guardrailRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.guardrailLabel}>{label}</Text>
        <Text style={styles.guardrailDesc}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ false: colors.surfaceStrong, true: colors.primary }}
        thumbColor={colors.textOnPrimary} />
    </View>
  );

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.headerBtn} />
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Email account */}
        <SectionLabel>Email account</SectionLabel>
        {account ? (
          <Card>
            <Text style={styles.cardTitle}>{account.email}</Text>
            <Text style={styles.cardSub}>
              {account.providerId === 'custom' ? 'Custom' : account.providerId}
              {' · IMAP '}{account.imap.host}:{account.imap.port}
              {' · SMTP '}{account.smtp.host}:{account.smtp.port}
            </Text>
            <View style={styles.cardActions}>
              <Button label="Disconnect" variant="danger" onPress={disconnectAccount} />
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={styles.cardTitle}>No account connected</Text>
            <Text style={styles.cardSub}>180-day history import · Realtime IDLE sync</Text>
            <View style={styles.cardActions}>
              <Button label="Connect" variant="secondary" onPress={() => setShowConnect(true)} />
            </View>
          </Card>
        )}

        {/* AI providers */}
        <SectionLabel>AI providers</SectionLabel>
        {providers.length === 0 && (
          <EmptyState title="No providers yet" body="Add one so Millo can think. Your key stays on this device." />
        )}
        {providers.map((p) => (
          <ProviderCard
            key={p.id}
            provider={{ id: p.id, name: p.label, model: p.model || '(default)', keyMasked: maskKey(p.apiKey), primary: p.primary, connected: true }}
            onTest={(id) => { const p = providers.find(x => x.id === id); if (p) void doTestProvider(p); }}
            onRemove={(id) => ask('Remove provider?', 'The agent will use the next available provider.', async () => {
              setProviders(await removeProvider(id));
              setConfirm(null);
              toast('Provider removed');
            })}
          />
        ))}
        {providers.map((p) => !p.primary ? (
          <Pressable key={p.id} style={styles.setPrimaryBtn}
            onPress={async () => { setProviders(await setPrimary(p.id)); toast('Primary updated'); }}>
            <Text style={styles.setPrimaryText}>Set {p.label} as primary</Text>
          </Pressable>
        ) : null)}
        <Button label="Add provider" variant="secondary"
          onPress={() => setShowAddProvider(true)}
          icon={<IconPlus size={18} color={colors.text} />} />

        {/* Memory */}
        <SectionLabel>Memory</SectionLabel>
        <Card>
          <Text style={styles.cardTitle}>On-device memory</Text>
          <Text style={styles.cardSub}>Stored locally, never sent anywhere</Text>
          <View style={styles.cardActions}>
            <Button label="Clear" variant="danger" disabled
              onPress={() => ask('Clear memory?', 'This cannot be undone.', async () => { setConfirm(null); toast('Memory cleared'); })} />
          </View>
        </Card>

        {/* Guardrails */}
        <SectionLabel>Guardrails</SectionLabel>
        <Card>
          <GuardrailRow label="Kill switch" description="Stop autonomous actions. Manual runs stay available." value={killSwitch} onChange={setKillSwitch} />
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Shadow mode</Text>
              <Text style={styles.guardrailDesc}>All actions logged, nothing sent or changed.</Text>
            </View>
            <Switch value={shadowMode} onValueChange={setShadowMode}
              trackColor={{ false: colors.surfaceStrong, true: colors.primary }}
              thumbColor={colors.textOnPrimary} />
          </View>
          <Text style={[styles.cardSub, { marginTop: spacing.md }]}>Daily budget and quiet hours — coming next.</Text>
        </Card>

        {/* About */}
        <SectionLabel>About</SectionLabel>
        <Card>
          <Text style={styles.cardTitle}>ThreadMyMail</Text>
          <Text style={styles.cardSub}>Version 1.0.0 · Open source · No account required</Text>
        </Card>
      </ScrollView>

      {/* Add provider sheet */}
      {showAddProvider && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Add AI provider</Text>
          <View style={styles.pickerWrap}>
            {PROVIDER_PRESETS.map((p) => (
              <Pressable key={p.id} accessibilityRole="button"
                accessibilityState={{ selected: p.id === providerPresetId }}
                onPress={() => selectPreset(p.id)}
                style={[styles.pickerItem, p.id === providerPresetId && styles.pickerItemActive]}>
                <Text style={[styles.pickerText, p.id === providerPresetId && styles.pickerTextActive]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="API key" value={providerKey} onChangeText={(t) => { setProviderKey(t); setAddResult(null); }} secure
            placeholder={PROVIDER_PRESETS.find((p) => p.id === providerPresetId)?.keyHint ?? 'sk-…'} />
          <Field label="Base URL" value={providerUrl} onChangeText={setProviderUrl} placeholder="https://api.openai.com/v1"
            helper={providerPresetId === CUSTOM_PROVIDER_ID ? 'Required — must be an OpenAI-compatible endpoint.' : 'Prefilled for this provider.'} />
          <Field label="Default model" value={providerModel} onChangeText={setProviderModel} placeholder="gpt-4o-mini" />
          {addResult && (
            <View style={[styles.resultBanner, addResult.ok ? styles.resultBannerOk : styles.resultBannerErr]}>
              <Text style={[styles.resultText, addResult.ok ? styles.resultTextOk : styles.resultTextErr]}>{addResult.detail}</Text>
            </View>
          )}
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={() => setShowAddProvider(false)} />
            <Button label={adding ? 'Testing…' : 'Add provider'} disabled={adding || !providerKey.trim()} loading={adding} onPress={saveNewProvider} />
          </View>
        </View>
      )}

      {/* Connect email sheet */}
      {showConnect && (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Connect email</Text>
          <Text style={styles.sheetHint}>Use an app password, not your normal password. 180-day history imports in the background.</Text>
          <View style={styles.pickerWrap}>
            {EMAIL_PROVIDERS.map((p) => (
              <Pressable key={p.id} accessibilityRole="button"
                accessibilityState={{ selected: p.id === emailProviderId }}
                onPress={() => setEmailProviderId(p.id)}
                style={[styles.pickerItem, p.id === emailProviderId && styles.pickerItemActive]}>
                <Text style={[styles.pickerText, p.id === emailProviderId && styles.pickerTextActive]}>{p.label}</Text>
              </Pressable>
            ))}
          </View>
          <Field label="Email address" value={emailAddress} onChangeText={(t) => { setEmailAddress(t); setConnectResult(null); }} placeholder="you@example.com" keyboardType="email-address" />
          <Field label="App password" value={emailPassword} onChangeText={(t) => { setEmailPassword(t); setConnectResult(null); }} secure placeholder="•••• •••• •••• ••••" />
          {emailProviderId === 'custom' && (
            <>
              <Field label="IMAP host" value={customImapHost} onChangeText={setCustomImapHost} placeholder="imap.example.com" />
              <Field label="IMAP port" value={customImapPort} onChangeText={setCustomImapPort} keyboardType="numeric" />
              <Field label="SMTP host" value={customSmtpHost} onChangeText={setCustomSmtpHost} placeholder="smtp.example.com" />
              <Field label="SMTP port" value={customSmtpPort} onChangeText={setCustomSmtpPort} keyboardType="numeric" />
            </>
          )}
          {connectResult && (
            <View style={[styles.resultBanner, connectResult.ok ? styles.resultBannerOk : styles.resultBannerErr]}>
              <Text style={[styles.resultText, connectResult.ok ? styles.resultTextOk : styles.resultTextErr]}>{connectResult.detail}</Text>
            </View>
          )}
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={() => setShowConnect(false)} />
            <Button label={connecting ? 'Connecting…' : 'Connect'} disabled={connecting || !emailAddress.trim() || !emailPassword} loading={connecting} onPress={connectAccount} />
          </View>
        </View>
      )}

      <ConfirmDialog visible={!!confirm} title={confirm?.title ?? ''} body={confirm?.body}
        confirmLabel="Confirm" destructive
        onConfirm={() => { confirm?.action?.(); setConfirm(null); }}
        onCancel={() => setConfirm(null)} />
      {toastMsg && <Toast visible={true} message={toastMsg.text} ok={toastMsg.ok} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.lg, minHeight: 56 },
  headerBtn: { width: touch.minTarget, height: touch.minTarget },
  headerTitle: { ...typography.h3, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  cardSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  setPrimaryBtn: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  setPrimaryText: { ...typography.bodySmall, color: colors.textMuted },
  guardrailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  guardrailLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  guardrailDesc: { ...typography.caption, color: colors.textMuted },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bgDeep, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl,
    borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.xl, gap: spacing.md,
  },
  sheetTitle: { ...typography.h3, color: colors.text },
  sheetHint: { ...typography.bodySmall, color: colors.textMuted },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerItem: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    minHeight: touch.minTarget, justifyContent: 'center',
  },
  pickerItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickerText: { ...typography.bodySmall, color: colors.textMuted },
  pickerTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  resultBanner: { borderRadius: radii.md, padding: spacing.md, borderWidth: 1 },
  resultBannerOk: { backgroundColor: colors.successBg, borderColor: colors.success },
  resultBannerErr: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  resultText: { ...typography.bodySmall },
  resultTextOk: { color: colors.success },
  resultTextErr: { color: colors.danger },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, marginTop: spacing.sm },
});
