/**
 * Settings — the control room. MVP-UI §4.5.
 * All four sections wired to real stores; "Test connection" calls live endpoints.
 */
import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { BottomSheet, Button, Card, ConfirmDialog, EmptyState, SectionHeader, Toast } from '../components/ui';
import { Field, ProviderCard } from '../components/settings';
import { PROVIDER_PRESETS, CUSTOM_PROVIDER_ID } from '../lib/providers';
import {
  loadProviders, removeProvider, setPrimary, addProvider,
  testProvider, maskKey, type SavedProvider,
} from '../lib/providerStore';
import {
  EMAIL_PROVIDERS, loadAccounts, removeAccount, saveAccount, setPrimaryAccount,
  type AccountConfig,
} from '../lib/accountStore';
import {
  getMailSync,
  registerMailAccounts,
  removeMailSync,
} from '../lib/mailSyncSingleton';
import {
  DEFAULT_DAILY_ACTION_LIMIT,
  DEFAULT_DAILY_AI_CALL_LIMIT,
  DEFAULT_FOLLOW_UP_DAYS,
  DEFAULT_FOLLOW_UP_TIME,
  DEFAULT_QUIET_END,
  DEFAULT_QUIET_START,
  DEFAULT_TRIAGE_TIME,
  formatMinutes,
  parseTimeLabel,
  setGuardrailConfig,
  setKillSwitch,
  setShadowMode,
  useGuardrails,
} from '../lib/guardrails';
import {
  DEFAULT_SKILLS,
  SKILL_DEFINITIONS,
  loadSkills,
  setSkill,
  type SkillId,
  type Skills,
} from '../lib/skillsStore';
import { testImap } from '../lib/emailTest';
import { runFollowUps } from '../lib/agent/followUps';
import {
  configureNotifications,
  muteSender,
  setNotificationPrefs,
  unmuteSender,
  useNotificationPrefs,
} from '../lib/notifications';
import { IconPlus } from '../components/Icons';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
import { useTheme, type ThemeMode } from '../theme/ThemeProvider';

// ── Confirm helper ────────────────────────────────────────────────────────
type Confirm = { title: string; body: string; action: () => void } | null;

export function SettingsScreen() {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const toast = (text: string, ok = true) => {
    setToastMsg({ text, ok });
    setTimeout(() => setToastMsg(null), 2500);
  };
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const ask = (title: string, body: string, action: () => void) =>
    setConfirm({ title, body, action });

  // ── Email account ───────────────────────────────────────────────────────
  const [accounts, setAccounts] = useState<AccountConfig[]>([]);
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

  useEffect(() => {
    void loadAccounts().then((saved) => {
      setAccounts(saved);
      registerMailAccounts(saved);
    });
  }, []);

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
      const next = await loadAccounts();
      setAccounts(next);
      registerMailAccounts(next);
      setShowConnect(false);
      setEmailPassword('');
      toast('Email connected');
      void getMailSync(saved.id).start({ imap: saved.imap, smtp: saved.smtp, auth: { user: saved.email, password: saved.password } });
    } catch (err) {
      setConnectResult({ ok: false, detail: err instanceof Error ? err.message : 'Could not save.' });
    } finally { setConnecting(false); }
  };

  const disconnectAccount = (account: AccountConfig) =>
    ask(
      `Disconnect ${account.email}?`,
      'This removes the account from this device. Cached messages stay in the inbox.',
      async () => {
        await getMailSync(account.id).stop();
        removeMailSync(account.id);
        const next = await removeAccount(account.id);
        setAccounts(next);
        registerMailAccounts(next);
        setConfirm(null);
        toast('Email disconnected');
      },
    );

  const makePrimary = async (account: AccountConfig) => {
    const next = await setPrimaryAccount(account.id);
    setAccounts(next);
    registerMailAccounts(next);
    toast(`${account.email} is now primary`);
  };

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
  const guardrails = useGuardrails();
  const { killSwitch, shadowMode } = guardrails;

  // ── Notifications ──────────────────────────────────────────────────────
  const notifications = useNotificationPrefs();
  const [muteAddress, setMuteAddress] = useState('');

  const changeNotifications = async (value: boolean) => {
    if (value) {
      const granted = await configureNotifications(true);
      if (!granted) {
        toast('Notification permission was not granted', false);
        return;
      }
    }
    await setNotificationPrefs({ enabled: value });
    toast(value ? 'New-mail notifications on' : 'New-mail notifications off');
  };

  const addMutedSender = async () => {
    const added = await muteSender(muteAddress);
    if (!added) {
      toast('Enter a sender email address', false);
      return;
    }
    setMuteAddress('');
    toast('Sender muted');
  };

  const changeKillSwitch = (value: boolean) => {
    if (value) {
      ask(
        'Stop all autonomous actions?',
        'Millo will stop triaging, drafting, and following up. You can still read and send mail yourself.',
        async () => {
          await setKillSwitch(true);
          setConfirm(null);
          toast('Kill switch engaged');
        },
      );
    } else {
      void setKillSwitch(false);
      toast('Autonomous actions enabled');
    }
  };

  const changeShadowMode = (value: boolean) => {
    void setShadowMode(value);
    toast(value ? 'Shadow mode on — nothing will be sent' : 'Shadow mode off');
  };

  // Budget/quiet-hour drafts stay as text while typing; commit on blur so a
  // half-typed number never overwrites the persisted value.
  const [actionLimitText, setActionLimitText] = useState(String(DEFAULT_DAILY_ACTION_LIMIT));
  const [aiLimitText, setAiLimitText] = useState(String(DEFAULT_DAILY_AI_CALL_LIMIT));
  const [quietStartText, setQuietStartText] = useState(formatMinutes(DEFAULT_QUIET_START));
  const [quietEndText, setQuietEndText] = useState(formatMinutes(DEFAULT_QUIET_END));
  const [triageTimeText, setTriageTimeText] = useState(formatMinutes(DEFAULT_TRIAGE_TIME));
  const [followUpDaysText, setFollowUpDaysText] = useState(String(DEFAULT_FOLLOW_UP_DAYS));
  const [followUpTimeText, setFollowUpTimeText] = useState(formatMinutes(DEFAULT_FOLLOW_UP_TIME));
  const [checkingFollowUps, setCheckingFollowUps] = useState(false);

  useEffect(() => {
    setActionLimitText(String(guardrails.dailyActionLimit));
    setAiLimitText(String(guardrails.dailyAiCallLimit));
    setQuietStartText(formatMinutes(guardrails.quietStart));
    setQuietEndText(formatMinutes(guardrails.quietEnd));
    setTriageTimeText(formatMinutes(guardrails.dailyTriageTime));
    setFollowUpDaysText(String(guardrails.followUpDays));
    setFollowUpTimeText(formatMinutes(guardrails.followUpTime));
  }, [
    guardrails.dailyActionLimit,
    guardrails.dailyAiCallLimit,
    guardrails.quietStart,
    guardrails.quietEnd,
    guardrails.dailyTriageTime,
    guardrails.followUpDays,
    guardrails.followUpTime,
  ]);

  const commitActionLimit = () => {
    const value = Number(actionLimitText);
    if (!Number.isFinite(value) || value < 1) {
      setActionLimitText(String(guardrails.dailyActionLimit));
      return;
    }
    void setGuardrailConfig({ dailyActionLimit: Math.round(value) });
  };

  const commitAiLimit = () => {
    const value = Number(aiLimitText);
    if (!Number.isFinite(value) || value < 1) {
      setAiLimitText(String(guardrails.dailyAiCallLimit));
      return;
    }
    void setGuardrailConfig({ dailyAiCallLimit: Math.round(value) });
  };

  const commitQuietStart = () => {
    const minutes = parseTimeLabel(quietStartText);
    if (minutes === null) {
      setQuietStartText(formatMinutes(guardrails.quietStart));
      return;
    }
    void setGuardrailConfig({ quietStart: minutes });
  };

  const commitQuietEnd = () => {
    const minutes = parseTimeLabel(quietEndText);
    if (minutes === null) {
      setQuietEndText(formatMinutes(guardrails.quietEnd));
      return;
    }
    void setGuardrailConfig({ quietEnd: minutes });
  };

  const changeQuietHours = (value: boolean) => {
    void setGuardrailConfig({ quietHoursEnabled: value });
    toast(value ? 'Quiet hours on' : 'Quiet hours off');
  };

  const commitFollowUpDays = () => {
    const value = Number(followUpDaysText);
    if (!Number.isFinite(value) || value < 1) {
      setFollowUpDaysText(String(guardrails.followUpDays));
      return;
    }
    void setGuardrailConfig({ followUpDays: Math.round(value) });
  };

  const commitFollowUpTime = () => {
    const minutes = parseTimeLabel(followUpTimeText);
    if (minutes === null) {
      setFollowUpTimeText(formatMinutes(guardrails.followUpTime));
      return;
    }
    void setGuardrailConfig({ followUpTime: minutes });
  };

  const checkFollowUpsNow = async () => {
    setCheckingFollowUps(true);
    const result = await runFollowUps('manual');
    setCheckingFollowUps(false);
    if (result.error) {
      toast(result.error, false);
      return;
    }
    if (result.count === 0) {
      toast('No cold threads right now');
      return;
    }
    toast(
      result.notified
        ? `${result.count} cold thread${result.count === 1 ? '' : 's'} found`
        : `${result.count} cold thread${result.count === 1 ? '' : 's'} found — notification blocked`,
      result.notified,
    );
  };

  const commitTriageTime = () => {
    const minutes = parseTimeLabel(triageTimeText);
    if (minutes === null) {
      setTriageTimeText(formatMinutes(guardrails.dailyTriageTime));
      return;
    }
    void setGuardrailConfig({ dailyTriageTime: minutes });
  };

  const changeDailyTriage = (value: boolean) => {
    void setGuardrailConfig({ dailyTriageEnabled: value });
    toast(value ? 'Daily triage on' : 'Daily triage off');
  };

  // ── Skills ─────────────────────────────────────────────────────────────
  const [skills, setSkillsState] = useState<Skills>({ ...DEFAULT_SKILLS });

  useEffect(() => {
    let cancelled = false;
    void loadSkills().then((saved) => {
      if (!cancelled) setSkillsState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const changeSkill = (id: SkillId, value: boolean) => {
    void setSkill(id, value).then((next) => {
      setSkillsState(next);
      const label = SKILL_DEFINITIONS.find((skill) => skill.id === id)?.label ?? 'Skill';
      toast(`${label} ${value ? 'on' : 'off'}`);
    });
  };

  const GuardrailRow = ({ label, description, value, onChange }: {
    label: string; description: string; value: boolean; onChange: (v: boolean) => void;
  }) => (
    <View style={styles.guardrailRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.guardrailLabel}>{label}</Text>
        <Text style={styles.guardrailDesc}>{description}</Text>
      </View>
      <Switch value={value} onValueChange={onChange}
        trackColor={{ false: colors.bgSurfaceHover, true: colors.primary }}
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
        <SectionHeader>Email accounts</SectionHeader>
        {accounts.length === 0 && (
          <Card>
            <Text style={styles.cardTitle}>No account connected</Text>
            <Text style={styles.cardSub}>180-day history import · Realtime IDLE sync</Text>
          </Card>
        )}
        {accounts.map((account) => (
          <Card key={account.id}>
            <View style={styles.accountHead}>
              <Text style={styles.cardTitle} numberOfLines={1}>{account.email}</Text>
              {account.primary && (
                <Text style={styles.primaryBadge}>Primary</Text>
              )}
            </View>
            <Text style={styles.cardSub}>
              {account.providerId === 'custom' ? 'Custom' : account.providerId}
              {' · IMAP '}{account.imap.host}:{account.imap.port}
              {' · SMTP '}{account.smtp.host}:{account.smtp.port}
            </Text>
            <View style={styles.cardActions}>
              {!account.primary && (
                <Button
                  label="Set primary"
                  variant="secondary"
                  onPress={() => void makePrimary(account)}
                />
              )}
              <Button
                label="Disconnect"
                variant="danger"
                onPress={() => disconnectAccount(account)}
              />
            </View>
          </Card>
        ))}
        <Button
          label={accounts.length === 0 ? 'Connect account' : 'Add another account'}
          variant="secondary"
          onPress={() => setShowConnect(true)}
          icon={<IconPlus size={18} color={colors.text} />}
        />

        {/* Appearance */}
        <SectionHeader>Appearance</SectionHeader>
        <Card>
          <Text style={styles.cardTitle}>Theme</Text>
          <Text style={styles.cardSub}>Follow the system automatically, or pin the app to dark or light.</Text>
          <View style={styles.appearanceRow}>
            {(['dark', 'light', 'system'] as ThemeMode[]).map((option) => {
              const selected = themeMode === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setThemeMode(option)}
                  style={[styles.appearanceOption, selected && styles.appearanceOptionActive]}
                >
                  <Text style={[styles.appearanceText, selected && styles.appearanceTextActive]}>
                    {option === 'system' ? 'Follow system' : option === 'dark' ? 'Dark' : 'Light'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* AI providers */}
        <SectionHeader>AI providers</SectionHeader>
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
        <SectionHeader>Memory</SectionHeader>
        <Card>
          <Text style={styles.cardTitle}>What Millo knows</Text>
          <Text style={styles.cardSub}>
            An on-device memory engine is under development (Issue #31).
            Once enabled, you will see a smart list of facts, preferences,
            commitments, and people the agent has learned about you.
          </Text>
          <View style={styles.comingSoonPill}>
            <Text style={styles.comingSoonText}>COMING SOON</Text>
          </View>
        </Card>

        {/* Guardrails */}
        <SectionHeader>Guardrails</SectionHeader>
        <Card>
          <GuardrailRow label="Kill switch" description="Stop autonomous actions. Manual runs stay available." value={killSwitch} onChange={changeKillSwitch} />
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Shadow mode</Text>
              <Text style={styles.guardrailDesc}>All actions logged, nothing sent or changed.</Text>
            </View>
            <Switch value={shadowMode} onValueChange={changeShadowMode}
              trackColor={{ false: colors.bgSurfaceHover, true: colors.primary }}
              thumbColor={colors.textOnPrimary} />
          </View>
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Daily action budget</Text>
              <Text style={styles.guardrailDesc}>Autonomous actions per day. Resets at local midnight.</Text>
            </View>
            <TextInput
              value={actionLimitText}
              onChangeText={setActionLimitText}
              onEndEditing={commitActionLimit}
              keyboardType="number-pad"
              maxLength={4}
              style={styles.numberInput}
              accessibilityLabel="Daily action budget"
            />
          </View>
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Daily AI-call budget</Text>
              <Text style={styles.guardrailDesc}>Model calls the agent may spend per day.</Text>
            </View>
            <TextInput
              value={aiLimitText}
              onChangeText={setAiLimitText}
              onEndEditing={commitAiLimit}
              keyboardType="number-pad"
              maxLength={4}
              style={styles.numberInput}
              accessibilityLabel="Daily AI-call budget"
            />
          </View>
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Quiet hours</Text>
              <Text style={styles.guardrailDesc}>No scheduled runs or notifications in this window.</Text>
            </View>
            <Switch
              value={guardrails.quietHoursEnabled}
              onValueChange={changeQuietHours}
              trackColor={{ false: colors.bgSurfaceHover, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
            />
          </View>
          {guardrails.quietHoursEnabled && (
            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.guardrailDesc}>From</Text>
                <TextInput
                  value={quietStartText}
                  onChangeText={setQuietStartText}
                  onEndEditing={commitQuietStart}
                  placeholder="22:00"
                  placeholderTextColor={colors.textSubtle}
                  maxLength={5}
                  style={styles.timeInput}
                  accessibilityLabel="Quiet hours start"
                />
              </View>
              <View style={styles.timeField}>
                <Text style={styles.guardrailDesc}>To</Text>
                <TextInput
                  value={quietEndText}
                  onChangeText={setQuietEndText}
                  onEndEditing={commitQuietEnd}
                  placeholder="07:00"
                  placeholderTextColor={colors.textSubtle}
                  maxLength={5}
                  style={styles.timeInput}
                  accessibilityLabel="Quiet hours end"
                />
              </View>
            </View>
          )}
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Daily morning triage</Text>
              <Text style={styles.guardrailDesc}>Runs once a day while the app is open. Quiet hours win.</Text>
            </View>
            <Switch
              value={guardrails.dailyTriageEnabled}
              onValueChange={changeDailyTriage}
              trackColor={{ false: colors.bgSurfaceHover, true: colors.primary }}
              thumbColor={colors.textOnPrimary}
            />
          </View>
          {guardrails.dailyTriageEnabled && (
            <View style={styles.timeRow}>
              <View style={styles.timeField}>
                <Text style={styles.guardrailDesc}>Run at</Text>
                <TextInput
                  value={triageTimeText}
                  onChangeText={setTriageTimeText}
                  onEndEditing={commitTriageTime}
                  placeholder="08:00"
                  placeholderTextColor={colors.textSubtle}
                  maxLength={5}
                  style={styles.timeInput}
                  accessibilityLabel="Daily triage time"
                />
              </View>
            </View>
          )}
          <Text style={[styles.cardSub, { marginTop: spacing.md }]}>
            {guardrails.actionsUsed}/{guardrails.dailyActionLimit} actions and{' '}
            {guardrails.aiCallsUsed}/{guardrails.dailyAiCallLimit} AI calls used today.
            Manual actions stay available during quiet hours.
          </Text>
        </Card>

        {/* Notifications */}
        <SectionHeader>Notifications</SectionHeader>
        <Card>
          <GuardrailRow
            label="New-mail notifications"
            description="Alert when a new message arrives while the app is running."
            value={notifications.enabled}
            onChange={changeNotifications}
          />
          <GuardrailRow
            label="Sound"
            description="Play the system notification sound."
            value={notifications.sound}
            onChange={(value) => void setNotificationPrefs({ sound: value })}
          />
          <GuardrailRow
            label="Vibrate"
            description="Vibrate when a new-mail alert arrives."
            value={notifications.vibrate}
            onChange={(value) => void setNotificationPrefs({ vibrate: value })}
          />
          <View style={styles.muteBlock}>
            <Text style={styles.guardrailDesc}>
              Muted senders never raise an alert. Their mail still arrives in the inbox.
            </Text>
            <View style={styles.muteRow}>
              <TextInput
                value={muteAddress}
                onChangeText={setMuteAddress}
                placeholder="sender@example.com"
                placeholderTextColor={colors.textSubtle}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                style={styles.muteInput}
                accessibilityLabel="Sender email to mute"
              />
              <Button label="Mute" variant="secondary" onPress={() => void addMutedSender()} />
            </View>
            {notifications.mutedSenders.length === 0 ? (
              <Text style={styles.cardSub}>No muted senders.</Text>
            ) : (
              notifications.mutedSenders.map((address) => (
                <View key={address} style={styles.mutedRow}>
                  <Text style={styles.mutedAddress} numberOfLines={1}>{address}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Unmute ${address}`}
                    onPress={() => void unmuteSender(address)}
                    style={styles.unmuteBtn}
                  >
                    <Text style={styles.unmuteText}>Unmute</Text>
                  </Pressable>
                </View>
              ))
            )}
          </View>
        </Card>

        {/* Follow-ups */}
        <SectionHeader>Follow-ups</SectionHeader>
        <Card>
          <GuardrailRow
            label="Follow-up reminders"
            description="Flag cold threads and remind you once a day. Also controlled by the Follow-ups skill."
            value={skills.follow_ups}
            onChange={(value) => changeSkill('follow_ups', value)}
          />
          <Text style={[styles.cardSub, { marginTop: spacing.md }]}>
            A thread is cold when an inbound message has waited longer than this, or when
            your last sent reply has had no answer.
          </Text>
          <View style={styles.guardrailRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.guardrailLabel}>Cold after</Text>
              <Text style={styles.guardrailDesc}>Days a thread can wait before it is flagged.</Text>
            </View>
            <TextInput
              value={followUpDaysText}
              onChangeText={setFollowUpDaysText}
              onEndEditing={commitFollowUpDays}
              keyboardType="number-pad"
              maxLength={2}
              style={styles.numberInput}
              accessibilityLabel="Cold thread threshold in days"
            />
          </View>
          <View style={styles.timeRow}>
            <View style={styles.timeField}>
              <Text style={styles.guardrailDesc}>Reminder time</Text>
              <TextInput
                value={followUpTimeText}
                onChangeText={setFollowUpTimeText}
                onEndEditing={commitFollowUpTime}
                placeholder="09:00"
                placeholderTextColor={colors.textSubtle}
                maxLength={5}
                style={styles.timeInput}
                accessibilityLabel="Follow-up reminder time"
              />
            </View>
          </View>
          <View style={styles.cardActions}>
            <Button
              label="Check now"
              variant="secondary"
              loading={checkingFollowUps}
              onPress={() => void checkFollowUpsNow()}
            />
          </View>
        </Card>

        {/* Skills */}
        <SectionHeader>Skills</SectionHeader>
        <Card>
          {SKILL_DEFINITIONS.map((skill) => (
            <View key={skill.id} style={styles.guardrailRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.guardrailLabel}>{skill.label}</Text>
                <Text style={styles.guardrailDesc}>{skill.description}</Text>
              </View>
              <Switch
                value={skills[skill.id]}
                onValueChange={(value) => changeSkill(skill.id, value)}
                trackColor={{ false: colors.bgSurfaceHover, true: colors.primary }}
                thumbColor={colors.textOnPrimary}
              />
            </View>
          ))}
          <Text style={[styles.cardSub, { marginTop: spacing.md }]}>
            Skills also obey the kill switch and shadow mode.
          </Text>
        </Card>

        {/* About */}
        <SectionHeader>About</SectionHeader>
        <Card>
          <Text style={styles.cardTitle}>ThreadMyMail</Text>
          <Text style={styles.cardSub}>Version 1.0.0 · Open source · No account required</Text>
        </Card>
      </ScrollView>

      <BottomSheet
        visible={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        title="Add AI provider"
        footer={(
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={() => setShowAddProvider(false)} />
            <Button label={adding ? 'Testing…' : 'Add provider'} disabled={adding || !providerKey.trim()} loading={adding} onPress={saveNewProvider} />
          </View>
        )}
      >
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
      </BottomSheet>

      <BottomSheet
        visible={showConnect}
        onClose={() => setShowConnect(false)}
        title="Connect email"
        footer={(
          <View style={styles.sheetActions}>
            <Button label="Cancel" variant="ghost" onPress={() => setShowConnect(false)} />
            <Button label={connecting ? 'Connecting…' : 'Connect'} disabled={connecting || !emailAddress.trim() || !emailPassword} loading={connecting} onPress={connectAccount} />
          </View>
        )}
      >
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
      </BottomSheet>

      <ConfirmDialog visible={!!confirm} title={confirm?.title ?? ''} body={confirm?.body}
        confirmLabel="Confirm" destructive
        onConfirm={() => { confirm?.action?.(); setConfirm(null); }}
        onCancel={() => setConfirm(null)} />
      {toastMsg && <Toast visible={true} message={toastMsg.text} ok={toastMsg.ok} />}
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.lg, minHeight: 56 },
  headerBtn: { width: touch.minTarget, height: touch.minTarget },
  headerTitle: { ...typography.h3, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  cardTitle: { ...typography.body, color: colors.text, fontWeight: '600' },
  accountHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  primaryBadge: {
    ...typography.label,
    fontSize: 9,
    color: colors.textOnPrimary,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  cardSub: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  cardActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  setPrimaryBtn: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  setPrimaryText: { ...typography.bodySmall, color: colors.textMuted },
  guardrailRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  guardrailLabel: { ...typography.body, color: colors.text, fontWeight: '600' },
  guardrailDesc: { ...typography.caption, color: colors.textMuted },
  numberInput: {
    width: 72,
    minHeight: touch.minTarget,
    textAlign: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
    ...typography.body,
    color: colors.text,
  },
  muteBlock: { paddingTop: spacing.md, gap: spacing.sm },
  muteRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  muteInput: {
    flex: 1,
    minHeight: touch.minTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  mutedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  mutedAddress: { flex: 1, ...typography.caption, color: colors.text },
  unmuteBtn: { minHeight: touch.minTarget, justifyContent: 'center', paddingHorizontal: spacing.sm },
  unmuteText: { ...typography.caption, color: colors.primaryText, fontWeight: '600' },
  timeRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  timeField: { flex: 1, gap: spacing.xs },
  timeInput: {
    minHeight: touch.minTarget,
    textAlign: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
    ...typography.body,
    color: colors.text,
  },
  sheetHint: { ...typography.bodySmall, color: colors.textMuted },
  appearanceRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  appearanceOption: {
    flex: 1,
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgSurface,
    paddingHorizontal: spacing.sm,
  },
  appearanceOptionActive: { borderColor: colors.primary, backgroundColor: colors.bgSurfaceHover },
  appearanceText: { ...typography.bodySmall, color: colors.textMuted, textAlign: 'center' },
  appearanceTextActive: { color: colors.primaryText, fontWeight: '600' },
  pickerWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pickerItem: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radii.pill,
    backgroundColor: colors.bgSurface, borderWidth: 1, borderColor: colors.border,
    minHeight: touch.minTarget, justifyContent: 'center',
  },
  pickerItemActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  pickerText: { ...typography.bodySmall, color: colors.textMuted },
  pickerTextActive: { color: colors.textOnPrimary, fontWeight: '600' },
  resultBanner: { borderRadius: radii.md, padding: spacing.md, borderWidth: 1 },
  resultBannerOk: { backgroundColor: colors.successBg, borderColor: colors.success },
  resultBannerErr: { backgroundColor: colors.dangerBg, borderColor: colors.danger },
  resultText: { ...typography.bodySmall },
  resultTextOk: { color: colors.successText },
  resultTextErr: { color: colors.dangerText },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.md, paddingVertical: spacing.sm },
  comingSoonPill: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  comingSoonText: { ...typography.label, color: colors.primaryText, fontWeight: '600' },
}));
