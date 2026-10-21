// TopBar – a simple persistent header across the app
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconBack, IconPower } from './Icons';
import { useGuardrails } from '../lib/guardrails';
import { colors, spacing, touch, typography } from '../theme/theme';

type TopBarProps = {
  title?: string;
  onBack?: () => void;
};

export function TopBar({ title = 'ThreadMyMail', onBack }: TopBarProps) {
  const { killSwitch } = useGuardrails();

  return (
    <View style={styles.container}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backBtn} accessibilityLabel="Back">
          <IconBack size={22} color={colors.text} />
        </Pressable>
      ) : (
        <View style={styles.backBtn} /> // placeholder to keep title centered
      )}
      <Text style={styles.title}>{title}</Text>
      <View style={styles.right}>
        {killSwitch && (
          <View style={styles.paused} accessibilityLabel="Autonomous actions paused">
            <IconPower size={16} color={colors.danger} />
            <Text style={styles.pausedText}>Paused</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bg, // matches overall background
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  right: {
    minWidth: touch.minTarget,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  paused: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    backgroundColor: colors.dangerBg,
  },
  pausedText: { ...typography.label, color: colors.danger },
  title: {
    ...typography.h2,
    color: colors.text,
  },
});
