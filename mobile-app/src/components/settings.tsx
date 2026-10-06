/**
 * Settings components — ProviderCard, SkillRow, Field (form input).
 * DB: Confirmation Dialogs (remove/clear), Submit Feedback (test connection).
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconChevron, IconTest, IconTrash } from './Icons';

/* ── ProviderCard ──────────────────────────────────────────────────────── */
export type Provider = {
  id: string;
  name: string;
  model: string;
  primary: boolean;
  connected: boolean;
  keyMasked: string;
};

type ProviderCardProps = {
  provider: Provider;
  onTest: (id: string) => void;
  onRemove: (id: string) => void;
};

export function ProviderCard({ provider, onTest, onRemove }: ProviderCardProps) {
  const [testing, setTesting] = useState(false);

  return (
    <View style={styles.card}>
      <View style={styles.cardMain}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardName}>{provider.name}</Text>
          {provider.primary && (
            <View style={styles.primaryBadge}>
              <Text style={styles.primaryBadgeText}>PRIMARY</Text>
            </View>
          )}
        </View>
        <Text style={styles.cardSub}>{provider.model}</Text>
        <Text style={styles.cardMeta}>{provider.keyMasked}</Text>
      </View>
      <View style={styles.cardActions}>
        <Pressable
          accessibilityLabel={`Test ${provider.name}`}
          onPress={() => {
            setTesting(true);
            onTest(provider.id);
            setTimeout(() => setTesting(false), 800);
          }}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        >
          <IconTest size={18} color={testing ? colors.primary : colors.accent} />
        </Pressable>
        <Pressable
          accessibilityLabel={`Remove ${provider.name}`}
          onPress={() => onRemove(provider.id)}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        >
          <IconTrash size={18} color={colors.danger} />
        </Pressable>
      </View>
    </View>
  );
}

/* ── SkillRow ──────────────────────────────────────────────────────────── */
export type Skill = {
  id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  shadow?: boolean;
};

type SkillRowProps = {
  skill: Skill;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (id: string) => void;
};

export function SkillRow({ skill, onToggle, onEdit }: SkillRowProps) {
  return (
    <View style={styles.skillRow}>
      <View style={styles.skillMain}>
        <View style={styles.skillTitleRow}>
          {skill.shadow && <View style={styles.shadowDot} />}
          <Text style={styles.skillName}>{skill.name}</Text>
        </View>
        <Text style={styles.skillTrigger}>{skill.trigger}</Text>
      </View>
      <Switch
        accessibilityLabel={`Toggle ${skill.name}`}
        value={skill.enabled}
        onValueChange={(v) => onToggle(skill.id, v)}
        trackColor={{ false: colors.surfaceStrong, true: colors.primary }}
        thumbColor={colors.textOnPrimary}
      />
      <Pressable
        accessibilityLabel={`Edit ${skill.name}`}
        onPress={() => onEdit(skill.id)}
        style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
      >
        <IconChevron size={20} color={colors.textSubtle} />
      </Pressable>
    </View>
  );
}

/* ── Field ─────────────────────────────────────────────────────────────── */
type FieldProps = {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  secure?: boolean;
  helper?: string;
  keyboardType?: 'default' | 'email-address' | 'numeric';
};

export function Field({ label, value, onChangeText, placeholder, secure, helper, keyboardType = 'default' }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.fieldInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSubtle}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel={label}
      />
      {helper ? <Text style={styles.fieldHelper}>{helper}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardMain: { flex: 1, gap: 2 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardName: { ...typography.body, color: colors.text, fontWeight: '600' },
  primaryBadge: {
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  primaryBadgeText: { ...typography.label, color: colors.textOnPrimary, fontSize: 9 },
  cardSub: { ...typography.caption, color: colors.textMuted },
  cardMeta: { ...typography.caption, color: colors.textSubtle },
  cardActions: { flexDirection: 'row', gap: spacing.xs },
  iconBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  skillMain: { flex: 1, gap: 2 },
  skillTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  skillName: { ...typography.body, color: colors.text, fontWeight: '600' },
  shadowDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.warn },
  skillTrigger: { ...typography.caption, color: colors.textMuted },
  field: { gap: spacing.xs },
  fieldLabel: { ...typography.label, color: colors.textMuted },
  fieldInput: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: touch.minTarget,
  },
  fieldHelper: { ...typography.caption, color: colors.textSubtle },
});
