/**
 * Navigation Drawer — Android-style overlay drawer for ThreadMyMail.
 * Opens from left edge or menu button; dismisses via back, outside tap, or swipe.
 * Lists recent conversations, New Chat, Search, and app destinations.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  BackHandler,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getConversations } from '../lib/conversationStore';
import { themedStyles, colors, radii, spacing, touch, typography } from '../theme/theme';
import { IconAgent, IconMail, IconActivity, IconSettings, IconSearch, IconPlus, IconChevron } from './Icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.85, 320);

type DrawerProps = {
  visible: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onOpenInbox: () => void;
  onOpenActions: () => void;
  onOpenSettings: () => void;
  activeConversationId?: string;
};

export function Drawer({
  visible,
  onClose,
  onNewChat,
  onSelectConversation,
  onOpenInbox,
  onOpenActions,
  onOpenSettings,
  activeConversationId,
}: DrawerProps) {
  const insets = useSafeAreaInsets();
  const [conversations, setConversations] = useState<Awaited<ReturnType<typeof getConversations>>>([]);
  const [loading, setLoading] = useState(true);
  // Stay mounted through the closing animation; unmounting on `visible=false`
  // would kill the slide-out before it is visible.
  const [mounted, setMounted] = useState(visible);

  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dx > 0) {
          translateX.setValue(Math.min(-DRAWER_WIDTH + gesture.dx, 0));
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > DRAWER_WIDTH * 0.3 || gesture.vx > 500) {
          Animated.timing(translateX, { toValue: 0, duration: 200, useNativeDriver: true }).start();
        } else {
          Animated.timing(translateX, { toValue: -DRAWER_WIDTH, duration: 200, useNativeDriver: true }).start(() => {
            onClose();
          });
        }
      },
    })
  ).current;

  // Load conversations when drawer opens
  useEffect(() => {
    if (visible) {
      setLoading(true);
      void (async () => {
        const convs = await getConversations();
        setConversations(convs);
        setLoading(false);
      })();
    }
  }, [visible]);

  // Animate drawer in/out. Reopening interrupts the close cleanly.
  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(translateX, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: visible ? 250 : 200,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, translateX]);

  // Back handler
  useEffect(() => {
    if (!visible) return;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => backHandler.remove();
  }, [visible, onClose]);

  if (!mounted) return null;

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      {/* Backdrop */}
      <Animated.View
        style={[
          styles.backdrop,
          {
            opacity: translateX.interpolate({
              inputRange: [-DRAWER_WIDTH, 0],
              outputRange: [0, 1],
            }),
          },
        ]}
        onStartShouldSetResponder={() => true}
        onResponderGrant={onClose}
      />

      {/* Drawer Content */}
      <Animated.View
        style={[
          styles.drawer,
          { transform: [{ translateX }] },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>ThreadMyMail</Text>
        </View>

        {/* Conversations Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Conversations</Text>
            <Pressable onPress={onNewChat} style={styles.newChatBtn} accessibilityLabel="New chat">
              <IconPlus size={18} color={colors.primary} />
              <Text style={styles.newChatText}>New Chat</Text>
            </Pressable>
          </View>

          {loading ? (
            <View style={styles.loading}>
              <Text style={styles.loadingText}>Loading…</Text>
            </View>
          ) : conversations.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No conversations yet</Text>
            </View>
          ) : (
            <View style={styles.conversationList}>
              {conversations.map((conv) => (
                <Pressable
                  key={conv.id}
                  onPress={() => {
                    onSelectConversation(conv.id);
                    onClose();
                  }}
                  style={[
                    styles.conversationItem,
                    conv.id === activeConversationId && styles.conversationItemActive,
                  ]}
                  android_ripple={{ color: colors.surfaceHover }}
                >
                  <IconAgent size={20} color={conv.id === activeConversationId ? colors.primary : colors.textMuted} />
                  <Text
                    style={[
                      styles.conversationTitle,
                      conv.id === activeConversationId && styles.conversationTitleActive,
                    ]}
                    numberOfLines={1}
                  >
                    {conv.title}
                  </Text>
                  {conv.id === activeConversationId && <IconChevron size={16} color={colors.primary} />}
                </Pressable>
              ))}
            </View>
          )}
        </View>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Search */}
        <Pressable
          onPress={() => {
            onClose();
            Alert.alert('Search', 'Not yet implemented');
          }}
          style={styles.destItem}
          android_ripple={{ color: colors.surfaceHover }}
        >
          <IconSearch size={22} color={colors.textMuted} />
          <Text style={styles.destText}>Search</Text>
        </Pressable>

        {/* Divider */}
        <View style={styles.divider} />

        {/* Destinations */}
        <Pressable
          onPress={() => { onOpenInbox(); onClose(); }}
          style={styles.destItem}
          android_ripple={{ color: colors.surfaceHover }}
        >
          <IconMail size={22} color={colors.textMuted} />
          <Text style={styles.destText}>Inbox</Text>
        </Pressable>

        <Pressable
          onPress={() => { onOpenActions(); onClose(); }}
          style={styles.destItem}
          android_ripple={{ color: colors.surfaceHover }}
        >
          <IconActivity size={22} color={colors.textMuted} />
          <Text style={styles.destText}>Actions</Text>
        </Pressable>

        <Pressable
          onPress={() => { onOpenSettings(); onClose(); }}
          style={styles.destItem}
          android_ripple={{ color: colors.surfaceHover }}
        >
          <IconSettings size={22} color={colors.textMuted} />
          <Text style={styles.destText}>Settings</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = themedStyles(() => ({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.scrim,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.bgDeep,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingTop: spacing.xl + 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.h3,
    color: colors.text,
  },
  section: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  newChatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.primaryBg,
    borderRadius: radii.sm,
  },
  newChatText: {
    ...typography.label,
    color: colors.primaryText,
    fontWeight: '600',
  },
  conversationList: {
    gap: spacing.xs,
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  conversationItemActive: {
    backgroundColor: colors.surfaceHover,
  },
  conversationTitle: {
    ...typography.body,
    color: colors.text,
    flex: 1,
  },
  conversationTitleActive: {
    color: colors.primaryText,
    fontWeight: '600',
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
    marginVertical: spacing.sm,
  },
  destItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
  },
  destText: {
    ...typography.body,
    color: colors.text,
  },
}));
