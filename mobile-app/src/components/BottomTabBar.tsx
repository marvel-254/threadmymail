/**
 * BottomTabBar — 5-tab navigation (Today · Mail · Millo · Activity · Settings).
 *
 * Structure, top to bottom:
 *   1. A hairline rule that reads as a physical boundary above the bar.
 *   2. The row of icon buttons, separated by vertical divider bars so the tabs
 *      read as discrete slots rather than one continuous strip.
 *   3. A label bar underneath carrying the page names, so the words are stable
 *      regardless of what the icon row is doing (active pill, Millo's raised
 *      button) — the icon row and the words stay in lockstep.
 *
 * Millo is the raised centre button: it is the heart of the product, so it is
 * the one control that breaks the grid.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconActivity, IconAgent, IconMail, IconSettings, IconToday } from './Icons';

export type TabId = 'today' | 'mail' | 'agent' | 'activity' | 'settings';

/** Display name for the Millo tab. The id stays 'agent' — it is the route. */
export const TAB_LABELS: Record<TabId, string> = {
  today: 'Today',
  mail: 'Mail',
  agent: 'Millo',
  activity: 'Activity',
  settings: 'Settings',
};

const TABS: TabId[] = ['today', 'mail', 'agent', 'activity', 'settings'];

function TabIcon({ id, active }: { id: TabId; active: boolean }) {
  const color = active ? colors.primary : colors.textMuted;
  switch (id) {
    case 'today':
      return <IconToday color={color} />;
    case 'mail':
      return <IconMail color={color} />;
    case 'agent':
      // Millo's button fills when active, so the icon flips to on-primary.
      return <IconAgent color={active ? colors.textOnPrimary : colors.textMuted} />;
    case 'activity':
      return <IconActivity color={color} />;
    case 'settings':
      return <IconSettings color={color} />;
  }
}

type BottomTabBarProps = {
  active: TabId;
  onSelect: (tab: TabId) => void;
};

export function BottomTabBar({ active, onSelect }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.wrapper}>
      {/* Boundary rule above the whole bar. */}
      <View style={styles.topRule} />

      {/* Icon row, divided into slots. */}
      <View style={styles.iconRow}>
        {TABS.map((id, index) => {
          const isActive = active === id;
          const isMillo = id === 'agent';
          return (
            <View key={id} style={styles.slot}>
              {index > 0 && <View style={styles.divider} />}
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={TAB_LABELS[id]}
                onPress={() => onSelect(id)}
                style={({ pressed }) => [
                  styles.iconSlot,
                  isActive && !isMillo && styles.iconSlotActive,
                  isMillo && styles.milloSlot,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <TabIcon id={id} active={isActive} />
              </Pressable>
            </View>
          );
        })}
      </View>

      {/* Label bar — the page names sit here, under their slots. */}
      <View style={[styles.labelBar, { paddingBottom: insets.bottom }]}>
        {TABS.map((id) => {
          const isActive = active === id;
          return (
            <View key={id} style={styles.labelSlot}>
              <Text
                style={[
                  styles.label,
                  isActive && styles.labelActive,
                  id === 'agent' && styles.labelMillo,
                ]}
                numberOfLines={1}
              >
                {TAB_LABELS[id]}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.bgDeep,
  },
  topRule: {
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
  slot: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Vertical hairline between adjacent slots.
  divider: {
    width: 1,
    alignSelf: 'stretch',
    marginVertical: spacing.xs,
    backgroundColor: colors.border,
  },
  iconSlot: {
    width: 40,
    height: 36,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlotActive: {
    backgroundColor: colors.surfaceStrong,
  },
  // Millo breaks the grid: a raised pill that reads as the primary action.
  milloSlot: {
    width: 56,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
    marginTop: -12,
  },
  labelBar: {
    flexDirection: 'row',
    paddingTop: 2,
    paddingBottom: spacing.sm,
  },
  labelSlot: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    ...typography.caption,
    color: colors.textSubtle,
    fontSize: 11,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  labelMillo: {
    color: colors.secondary,
    fontWeight: '600',
  },
});
