/**
 * Millo — the live conversation stream (the heart of the product).
 * MVP-UI §4.3 · DB: Streaming (token-by-token), Disclaimer (AI label),
 * Feedback Loop (thumbs), Typing indicators, Empty States.
 *
 * Responsiveness improvements:
 *  - Auto-scroll to newest message (with onContentSizeChange + onLayout)
 *  - KeyboardAvoidingView so the composer stays above the keyboard
 *  - Real token-by-token streaming (typewriter) instead of a single swap
 *  - User bubbles (right-aligned) so the conversation reads naturally
 *  - Quick suggestion chips for one-tap prompts
 *  - Dismiss keyboard on scroll
 *
 * v3 additions (Android-native):
 *  - Native top app bar with conversation title + overflow menu
 *  - Stop-generation control while streaming
 *  - Full-height conversation with proper inset handling
 *  - Long-press message actions (copy, context)
 *  - Message references to email threads
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  BackHandler,
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AgentBubble, EscalationCard, ToolChip } from '../components/agent';
import { Composer } from '../components/mail';
import { BottomSheet, Button, EmptyState } from '../components/ui';
import { WallpaperPicker } from '../components/WallpaperPicker';
import { IconAgent, IconBack, IconMenu, IconCopy, IconMail, IconMoreVertical } from '../components/Icons';
import { themedStyles, colors, radii, spacing, touch, typography, motion } from '../theme/theme';
import {
  createConversation,
  deleteConversation,
  deleteMessages,
  getConversation,
  getMessages,
  saveMessage,
  saveMessages,
  updateConversationTitle,
  updateConversationWallpaper,
  streamItemToMessage,
  messageToStreamItem,
  type Conversation,
  type StreamItem,
} from '../lib/conversationStore';
import { streamChat, type ChatMessage } from '../lib/aiClient';
import {
  DEFAULT_WALLPAPER,
  resolveWallpaper,
  serializeOverride,
  setGlobalWallpaper,
  presetSource,
  type WallpaperSetting,
} from '../lib/wallpaper';

type AgentScreenProps = {
  onBack?: () => void;
  conversationId?: string;
  conversationTitle?: string;
  onNewChat?: () => void;
  onConversationChange?: (id: string) => void;
  onOpenDrawer?: () => void;
  onOpenMailThread?: (threadId: string) => void;
};

export function AgentScreen({
  onBack,
  conversationId,
  conversationTitle = 'New Chat',
  onNewChat,
  onConversationChange,
  onOpenDrawer,
  onOpenMailThread,
}: AgentScreenProps) {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<StreamItem[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [longPressItem, setLongPressItem] = useState<StreamItem | null>(null);
  const [showLongPressSheet, setShowLongPressSheet] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [renameText, setRenameText] = useState('');
  const [wallpaper, setWallpaper] = useState<WallpaperSetting>(DEFAULT_WALLPAPER);
  const [showWallpaperPicker, setShowWallpaperPicker] = useState(false);
  const listRef = useRef<FlatList<StreamItem>>(null);
  const streamCleanup = useRef<(() => void) | null>(null);
  const stopGenerationRef = useRef<(() => void) | null>(null);

  // Load or create conversation on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let conv: Conversation | null = null;
        if (conversationId) {
          conv = await getConversation(conversationId);
        }
        if (!conv) {
          conv = await createConversation(conversationTitle);
        }
        if (cancelled) return;
        setCurrentConversation(conv);
        const msgs = await getMessages(conv.id);
        setItems(msgs.map(messageToStreamItem));
        // Resolve wallpaper: conversation override > global default
        const wp = await resolveWallpaper(conv.wallpaperOverride);
        if (!cancelled) setWallpaper(wp);
      } catch (e) {
        console.error('Failed to load conversation:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conversationId, conversationTitle]);

  // Apply wallpaper change to the conversation override (or global default).
  const handleApplyWallpaper = useCallback(async (setting: WallpaperSetting) => {
    setWallpaper(setting);
    if (currentConversation) {
      await updateConversationWallpaper(currentConversation.id, serializeOverride(setting));
    } else {
      await setGlobalWallpaper(setting);
    }
  }, [currentConversation]);

  // Auto-scroll to the newest message whenever items change.
  useEffect(() => {
    const t = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [items]);

  // Clean up any in-flight stream on unmount.
  useEffect(() => () => streamCleanup.current?.(), []);

  // Back handler for overflow menu and long-press sheet
  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (showOverflow) {
        setShowOverflow(false);
        return true;
      }
      if (showLongPressSheet) {
        setShowLongPressSheet(false);
        setLongPressItem(null);
        return true;
      }
      if (showRename) {
        setShowRename(false);
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [showOverflow, showLongPressSheet, showRename]);

  const send = useCallback(async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy || !currentConversation) return;
    const conversationId = currentConversation.id;

    const userItem: StreamItem = { type: 'user', id: `u${Date.now()}`, text: prompt };
    const agentId = `a${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const agentItem: StreamItem = { type: 'agent', id: agentId, text: '', streaming: true };

    const history: ChatMessage[] = items
      .filter((item): item is Extract<StreamItem, { type: 'user' | 'agent' }> =>
        item.type === 'user' || item.type === 'agent')
      .map((item): ChatMessage => ({
        role: item.type === 'user' ? 'user' : 'assistant',
        content: item.text,
      }))
      .filter((message) => message.content.trim().length > 0);

    setItems((prev) => [...prev, userItem, agentItem]);
    setBusy(true);
    setStreaming(true);
    void saveMessage(streamItemToMessage(userItem, conversationId)).catch(() => undefined);

    const controller = new AbortController();
    const abort = () => controller.abort();
    stopGenerationRef.current = abort;
    streamCleanup.current = abort;

    const result = await streamChat({
      messages: [...history, { role: 'user', content: prompt }],
      signal: controller.signal,
      onToken: (token) => {
        setItems((prev) => prev.map((item) =>
          item.id === agentId && item.type === 'agent'
            ? { ...item, text: item.text + token }
            : item));
      },
    });

    stopGenerationRef.current = null;
    streamCleanup.current = null;
    setStreaming(false);
    setBusy(false);

    if (result.ok && result.text.trim()) {
      setItems((prev) => prev.map((item) =>
        item.id === agentId && item.type === 'agent'
          ? { ...item, text: result.text, streaming: false }
          : item));
      try {
        await saveMessage(streamItemToMessage(
          { type: 'agent', id: agentId, text: result.text },
          conversationId,
        ));
      } catch {
        // The reply is still visible; persistence can be retried on the next send.
      }
      return;
    }

    // Drop the empty agent placeholder and explain what happened, with a retry
    // path for provider errors. Error notices are not persisted.
    setItems((prev) => prev.filter((item) => item.id !== agentId));
    const notice: StreamItem = {
      type: 'notice',
      id: `n${Date.now()}`,
      text: result.ok
        ? 'Stopped — no response yet.'
        : result.error,
      retryText: result.ok ? undefined : prompt,
    };
    setItems((prev) => [...prev, notice]);
  }, [busy, currentConversation, items]);

  const handleNewChat = useCallback(async () => {
    const conv = await createConversation('New Chat');
    setCurrentConversation(conv);
    setItems([]);
    onConversationChange?.(conv.id);
    onNewChat?.();
  }, [onNewChat, onConversationChange]);

  const handleStopGeneration = useCallback(() => {
    // The send loop finalises the partial text and clears busy/streaming when
    // the abort resolves, so the partial response is what gets persisted.
    stopGenerationRef.current?.();
  }, []);

  const handleLongPress = useCallback((item: StreamItem) => {
    if (item.type === 'agent' || item.type === 'user') {
      setLongPressItem(item);
      setShowLongPressSheet(true);
    }
  }, []);

  const handleCopyText = useCallback(async () => {
    if (longPressItem && (longPressItem.type === 'agent' || longPressItem.type === 'user')) {
      await Clipboard.setStringAsync(longPressItem.text);
      setShowLongPressSheet(false);
      setLongPressItem(null);
    }
  }, [longPressItem]);

  const handleUseAsContext = useCallback(() => {
    if (longPressItem && (longPressItem.type === 'agent' || longPressItem.type === 'user')) {
      console.log('Use as email context:', longPressItem.text);
      setShowLongPressSheet(false);
      setLongPressItem(null);
    }
  }, [longPressItem]);

  const openRenameConversation = useCallback(() => {
    if (!currentConversation) return;
    setRenameText(currentConversation.title);
    setShowOverflow(false);
    setShowRename(true);
  }, [currentConversation]);

  const handleRenameConversation = useCallback(async () => {
    if (!currentConversation) return;
    const newTitle = renameText.trim();
    if (!newTitle) {
      setShowRename(false);
      return;
    }
    if (newTitle !== currentConversation.title) {
      await updateConversationTitle(currentConversation.id, newTitle);
      setCurrentConversation({ ...currentConversation, title: newTitle });
    }
    setShowRename(false);
  }, [currentConversation, renameText]);

  const handleClearConversation = useCallback(async () => {
    if (!currentConversation) return;
    const conversationId = currentConversation.id;
    Alert.alert('Clear conversation?', 'This will remove all messages but keep the conversation.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', onPress: async () => {
        await deleteMessages(conversationId);
        setItems([]);
      }},
    ]);
    setShowOverflow(false);
  }, [currentConversation]);

  const handleDeleteConversation = useCallback(async () => {
    if (!currentConversation) return;
    const conversationId = currentConversation.id;
    Alert.alert('Delete conversation?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteConversation(conversationId);
        const conv = await createConversation('New Chat');
        setCurrentConversation(conv);
        setItems([]);
        onConversationChange?.(conv.id);
        onNewChat?.();
      }},
    ]);
    setShowOverflow(false);
  }, [currentConversation, onNewChat, onConversationChange]);

  const renderItem = useCallback(({ item }: { item: StreamItem }) => {
    const isLongPressable = item.type === 'agent' || item.type === 'user';
    const pressableProps = isLongPressable
      ? {
          onLongPress: () => handleLongPress(item),
          accessibilityActions: [{ name: 'copy', label: 'Copy text' }],
          onAccessibilityAction: (e: { nativeEvent: { actionName: string } }) => {
            if (e.nativeEvent.actionName === 'copy') handleLongPress(item);
          },
        }
      : {};

    const emailRefs = (item.type === 'agent' || item.type === 'user') ? (item.emailRefs ?? []) : [];

    switch (item.type) {
      case 'agent':
        return (
          <Pressable {...pressableProps} style={styles.messageWrapper}>
            <AgentBubble text={item.text} streaming={item.streaming} showFeedback />
            {emailRefs.length > 0 && (
              <View style={styles.emailRefs}>
                {emailRefs.map((ref) => (
                  <Pressable
                    key={ref.threadId}
                    onPress={() => onOpenMailThread?.(ref.threadId)}
                    style={styles.emailRefChip}
                    android_ripple={{ color: colors.surfaceHover }}
                  >
                    <IconMail size={14} color={colors.accent} />
                    <Text style={styles.emailRefText} numberOfLines={1}>
                      {ref.subject}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Pressable>
        );
      case 'user':
        return (
          <Pressable {...pressableProps} style={styles.messageWrapper}>
            <View style={styles.userBubble}>
              <Text style={styles.userText}>{item.text}</Text>
            </View>
            {emailRefs.length > 0 && (
              <View style={styles.emailRefs}>
                {emailRefs.map((ref) => (
                  <Pressable
                    key={ref.threadId}
                    onPress={() => onOpenMailThread?.(ref.threadId)}
                    style={styles.emailRefChip}
                    android_ripple={{ color: colors.surfaceHover }}
                  >
                    <IconMail size={14} color={colors.accent} />
                    <Text style={styles.emailRefText} numberOfLines={1}>
                      {ref.subject}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
          </Pressable>
        );
      case 'tool':
        return <ToolChip name={item.name} args={item.args} latencyMs={item.latencyMs} ok={item.ok} />;
      case 'notice':
        return (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{item.text}</Text>
            {item.retryText ? (
              <Pressable
                accessibilityLabel="Retry"
                onPress={() => { void send(item.retryText as string); }}
                style={styles.noticeRetryBtn}
              >
                <Text style={styles.noticeRetryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        );
      case 'escalation':
        return (
          <EscalationCard
            question={item.question}
            choices={[{ label: 'Yes', primary: true }, { label: 'No' }]}
            onChoose={() => {}}
          />
        );
    }
  }, [handleLongPress, onOpenMailThread, send]);

  const overflowItems = [
    { label: 'Rename conversation', onPress: openRenameConversation },
    {
      label: 'Wallpaper',
      onPress: () => {
        setShowOverflow(false);
        setShowWallpaperPicker(true);
      },
    },
    { label: 'Clear conversation', onPress: handleClearConversation },
    { label: 'Delete conversation', onPress: handleDeleteConversation },
  ];

  if (loading) {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.topBar, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityLabel="Open navigation drawer"
            onPress={onOpenDrawer}
            style={styles.topBarBtn}
          >
            <IconMenu size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.topBarTitle} numberOfLines={1}>{conversationTitle}</Text>
          <Pressable
            accessibilityLabel="Conversation options"
            onPress={() => setShowOverflow(true)}
            style={styles.topBarBtn}
          >
            <IconMoreVertical size={24} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.loadingCenter}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </KeyboardAvoidingView>
    );
  }

return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      {/* Wallpaper layer — behind messages only (not top bar, stop bar, composer) */}
      <View style={styles.wallpaperLayer}>
        <Image
          source={
            wallpaper.source.kind === 'custom'
              ? { uri: wallpaper.source.uri }
              : presetSource(wallpaper.source.id)
          }
          style={styles.wallpaperImg}
          resizeMode="cover"
        />
        <View style={{ ...styles.wallpaperDim, backgroundColor: `rgba(${colors.dimRgb},${wallpaper.dim})` }} />
      </View>

      {/* Top App Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top }]}>
        <Pressable
          accessibilityLabel="Open navigation drawer"
          onPress={onOpenDrawer}
          style={styles.topBarBtn}
        >
          <IconMenu size={24} color={colors.text} />
        </Pressable>
        <Text style={styles.topBarTitle} numberOfLines={1}>{currentConversation?.title ?? conversationTitle}</Text>
        <Pressable
          accessibilityLabel="Conversation options"
          onPress={() => setShowOverflow(true)}
          style={styles.topBarBtn}
        >
          <IconMoreVertical size={24} color={colors.text} />
        </Pressable>
      </View>

      {/* Conversation List */}
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => Keyboard.dismiss()}
        ListEmptyComponent={
          <EmptyState
            icon={<IconAgent size={48} color={colors.textSubtle} />}
            title="What can I help you with?"
            body="Your inbox, conversations, and next steps."
            action={
              <View style={styles.emptyActions}>
                <Pressable
                  accessibilityLabel="Draft a reply"
                  onPress={() => send('Draft a reply to the latest email')}
                  style={styles.emptyActionBtn}
                >
                  <Text style={styles.emptyActionText}>Draft a reply</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Find commitments"
                  onPress={() => send('Find commitments and deadlines in my emails')}
                  style={styles.emptyActionBtn}
                >
                  <Text style={styles.emptyActionText}>Find commitments</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Review follow-ups"
                  onPress={() => send('Review follow-ups that need attention')}
                  style={styles.emptyActionBtn}
                >
                  <Text style={styles.emptyActionText}>Review follow-ups</Text>
                </Pressable>
              </View>
            }
          />
        }
      />

      {/* Stop Generation Bar */}
      {streaming && (
        <View style={styles.stopBar}>
          <Text style={styles.stopText}>Millo is responding…</Text>
          <Pressable
            accessibilityLabel="Stop generation"
            onPress={handleStopGeneration}
            style={styles.stopBtn}
          >
            <Text style={styles.stopBtnText}>Stop</Text>
          </Pressable>
        </View>
      )}

      {/* Composer */}
      <View style={[styles.composerBar, { paddingBottom: insets.bottom }]}>
        <Composer
          placeholder="Message Millo…"
          disabled={busy}
          disabledReason={busy ? 'Millo is working…' : undefined}
          onSend={send}
        />
      </View>

      {/* Overflow Menu Modal */}
      <Modal
        transparent
        visible={showOverflow}
        animationType="fade"
        onRequestClose={() => setShowOverflow(false)}
      >
        <View style={styles.overflowBackdrop}>
          <View style={styles.overflowMenu} pointerEvents="box-none">
            {overflowItems.map((item, index) => (
              <Pressable
                key={index}
                onPress={item.onPress}
                style={styles.overflowItem}
                android_ripple={{ color: colors.surfaceHover }}
              >
                <Text style={styles.overflowItemText}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

      {/* Long Press Action Sheet */}
      <BottomSheet
        visible={showLongPressSheet}
        onClose={() => { setShowLongPressSheet(false); setLongPressItem(null); }}
        title="Message actions"
        scroll={false}
      >
        <Pressable
          onPress={handleCopyText}
          style={styles.sheetItem}
          android_ripple={{ color: colors.surfaceHover }}
        >
          <IconCopy size={20} color={colors.text} />
          <Text style={styles.sheetItemText}>Copy text</Text>
        </Pressable>
        <Pressable
          onPress={handleUseAsContext}
          style={styles.sheetItem}
          android_ripple={{ color: colors.surfaceHover }}
        >
          <IconMail size={20} color={colors.text} />
          <Text style={styles.sheetItemText}>Use as context</Text>
        </Pressable>
      </BottomSheet>

      {/* Rename Conversation Dialog */}
      <Modal
        transparent
        visible={showRename}
        animationType="fade"
        onRequestClose={() => setShowRename(false)}
      >
        <View style={styles.renameBackdrop}>
          <View style={styles.renameCard}>
            <Text style={styles.renameTitle}>Rename conversation</Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              selectTextOnFocus
              maxLength={80}
              placeholder="Conversation name"
              placeholderTextColor={colors.textSubtle}
              style={styles.renameInput}
              onSubmitEditing={() => { void handleRenameConversation(); }}
              returnKeyType="done"
            />
            <View style={styles.renameActions}>
              <Button label="Cancel" variant="ghost" onPress={() => setShowRename(false)} />
              <Button label="Save" onPress={() => { void handleRenameConversation(); }} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Wallpaper Picker Sheet */}
      <WallpaperPicker
        visible={showWallpaperPicker}
        current={wallpaper}
        onApply={handleApplyWallpaper}
        onClose={() => setShowWallpaperPicker(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  wallpaperLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: -1,
  },
  wallpaperImg: {
    ...StyleSheet.absoluteFill,
  },
  wallpaperDim: {
    ...StyleSheet.absoluteFill,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    minHeight: 56,
    backgroundColor: colors.bgDeep,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  topBarBtn: {
    width: touch.minTarget,
    height: touch.minTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  topBarTitle: {
    ...typography.h3,
    color: colors.text,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: spacing.md,
  },
  loadingCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  listContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  messageWrapper: {
    borderRadius: radii.md,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    borderTopRightRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  userText: { ...typography.body, color: colors.textOnPrimary },
  notice: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  noticeText: { ...typography.bodySmall, color: colors.textMuted },
  noticeRetryBtn: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
    minHeight: touch.minTarget,
    justifyContent: 'center',
  },
  noticeRetryText: { ...typography.bodySmall, color: colors.accent, fontWeight: '600' },
  composerBar: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.bgDeep,
  },
  stopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.warnBg,
    borderBottomWidth: 1,
    borderBottomColor: colors.warn,
  },
  stopText: { ...typography.bodySmall, color: colors.warnText },
  stopBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.warn,
    borderRadius: radii.sm,
  },
  stopBtnText: { ...typography.label, color: colors.textOnAccent, fontWeight: '600' },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  emptyActionBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emptyActionText: { ...typography.bodySmall, color: colors.text },
  emailRefs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  emailRefChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emailRefText: {
    ...typography.caption,
    color: colors.textSubtle,
    maxWidth: 200,
  },
  overflowBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-start',
    paddingTop: 80,
  },
  overflowMenu: {
    marginRight: spacing.md,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    width: 220,
    alignSelf: 'flex-end',
  },
  overflowItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  overflowItemText: { ...typography.body, color: colors.text },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surfaceStrong,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
    width: '100%',
  },
  sheetHandle: {
    width: 40,
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  sheetItemText: { ...typography.body, color: colors.text },
  renameBackdrop: {
    flex: 1,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  renameCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.md,
  },
  renameTitle: { ...typography.h3, color: colors.text },
  renameInput: {
    minHeight: touch.minTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    ...typography.body,
    color: colors.text,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
}));

export default AgentScreen;
