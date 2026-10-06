/**
 * BottomTabBar — 5-tab navigation (Today · Mail · Agent · Activity · Settings).
 * Active tab: primary color + 3px indicator bar (color-not-only-indicator).
 * Agent tab: raised primary circle (the heart of the product).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconActivity, IconAgent, IconMail, IconSettings, IconToday } from './Icons';

export type TabId = 'today' | 'mail' | 'agent' | 'activity' | 'settings';

const TABS: { id: TabId; label: string; icon: (active: boolean) => React.ReactNode }[] = [
  { id: 'today', label: 'Today', icon: (a) => <IconToday color={a ? colors.primary : colors.textMuted} /> },
  { id: 'mail', label: 'Mail', icon: (a) => <IconMail color={a ? colors.primary : colors.textMuted} /> },
  { id: 'agent', label: 'Agent', icon: (a) => <IconAgent color={a ? '#fff' : colors.textMuted} /> },
  { id: 'activity', label: 'Activity', icon: (a) => <IconActivity color={a ? colors.primary : colors.textMuted} /> },
  { id: 'settings', label: 'Settings', icon: (a) => <IconSettings color={a ? colors.primary : colors.textMuted} /> },
];

type BottomTabBarProps = {
  active: TabId;
  onSelect: (tab: TabId) => void;
};

export function BottomTabBar({ active, onSelect }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]}>
      {TABS.map((tab) => {
        const isActive = active === tab.id;
        const isAgent = tab.id === 'agent';
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={tab.label}
            onPress={() => onSelect(tab.id)}
            style={({ pressed }) => [
              styles.tab,
              pressed && { opacity: 0.7 },
            ]}
          >
            {isAgent ? (
              <View style={[styles.agentCircle, isActive && styles.agentCircleActive]}>
                {tab.icon(isActive)}
              </View>
            ) : (
              <>
                {tab.icon(isActive)}
                <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
              </>
            )}
            {isActive && !isAgent && <View style={styles.activeBar} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.bgDeep,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    position: 'relative',
  },
  tabLabel: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  tabLabelActive: { color: colors.primary, fontWeight: '600' },
  activeBar: {
    position: 'absolute',
    top: 0,
    width: 24,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.primary,
  },
  agentCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceStrong,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: -16,
  },
  agentCircleActive: { backgroundColor: colors.primary, borderColor: colors.primary },
});
