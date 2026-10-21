/**
 * BottomTabBar — 5-tab navigation (Today · Mail · Millo · Activity · Settings).
 *
 * Each tab is one Pressable covering the icon and the word, so the visually
 * obvious target is the real target and every slot clears the 48dp rule from
 * theme.ts. The bar keeps its compact height by packing the icon and label into
 * that single target instead of stacking separate rows.
 *
 * Millo is the raised centre button: it is the heart of the product, so it is
 * the one control that breaks the grid.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
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
  /** Unread mail count shown on the Mail tab; hidden at zero. */
  unreadCount?: number;
};

export function BottomTabBar({ active, onSelect, unreadCount = 0 }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const badgeLabel = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom }]}>
      {/* Boundary rule above the whole bar. */}
      <View style={styles.topRule} />

      <View style={styles.row}>
        {TABS.map((id, index) => {
          const isActive = active === id;
          const isMillo = id === 'agent';
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={
                id === 'mail' && unreadCount > 0
                  ? `Mail, ${unreadCount} unread`
                  : TAB_LABELS[id]
              }
              onPress={() => onSelect(id)}
              android_ripple={{ color: colors.surfaceHover, borderless: false }}
              style={({ pressed }) => [
                styles.slot,
                index > 0 && styles.slotDivider,
                pressed && styles.slotPressed,
              ]}
            >
              <View
                style={[
                  styles.iconSlot,
                  isActive && !isMillo && styles.iconSlotActive,
                  isMillo && styles.milloSlot,
                  isMillo && isActive && styles.milloSlotActive,
                ]}
              >
                <TabIcon id={id} active={isActive} />
                {id === 'mail' && unreadCount > 0 && (
                  <View style={styles.badge} pointerEvents="none">
                    <Text style={styles.badgeText}>{badgeLabel}</Text>
                  </View>
                )}
              </View>
              <Text
                style={[
                  styles.label,
                  isActive && styles.labelActive,
                  isMillo && styles.labelMillo,
                ]}
                numberOfLines={1}
              >
                {TAB_LABELS[id]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  wrapper: {
    backgroundColor: colors.bgDeep,
    justifyContent: 'center',
  },
  topRule: {
    height: 1,
    backgroundColor: colors.borderStrong,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  // One target per tab: icon + label, never smaller than 48dp.
  slot: {
    flex: 1,
    minHeight: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  slotDivider: {
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  slotPressed: {
    opacity: 0.72,
  },
  iconSlot: {
    width: 40,
    height: 26,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlotActive: {
    backgroundColor: colors.surfaceStrong,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: radii.pill,
    paddingHorizontal: 4,
    backgroundColor: colors.primary,
    borderWidth: 1,
    borderColor: colors.bgDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...typography.caption,
    color: colors.textOnPrimary,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '700',
  },
  // Millo breaks the grid: a raised pill that reads as the primary action.
  milloSlot: {
    width: 50,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.borderPrimary,
    marginTop: -8,
  },
  milloSlotActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  label: {
    ...typography.caption,
    color: colors.textSubtle,
  },
  labelActive: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  labelMillo: {
    color: colors.secondary,
    fontWeight: '600',
  },
}));
