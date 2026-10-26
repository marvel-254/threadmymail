/**
 * WallpaperPicker — full-height bottom sheet for choosing a wallpaper.
 *
 * Spec §7: built-in preset gallery, custom upload via the system Photo Picker,
 * live preview, dimming adjustment, Apply / Reset.
 */
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BottomSheet } from './ui';
import { themedStyles, colors, radii, spacing, typography } from '../theme/theme';
import {
  PRESET_IDS,
  presetSource,
  pickCustomWallpaper,
  type WallpaperSetting,
} from '../lib/wallpaper';

type WallpaperPickerProps = {
  visible: boolean;
  current: WallpaperSetting;
  onApply: (setting: WallpaperSetting) => void;
  onClose: () => void;
};

export function WallpaperPicker({ visible, current, onApply, onClose }: WallpaperPickerProps) {
  const [draft, setDraft] = useState<WallpaperSetting>(current);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setDraft(current);
      setError(null);
    }
  }, [visible, current]);

  const handlePickCustom = async () => {
    setPicking(true);
    setError(null);
    try {
      const uri = await pickCustomWallpaper();
      if (uri) {
        setDraft({ source: { kind: 'custom', uri }, dim: draft.dim });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not pick an image.');
    } finally {
      setPicking(false);
    }
  };

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const handleReset = () => {
    setDraft(current);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Wallpaper"
      scroll={false}
      headerRight={(
        <Pressable
          accessibilityLabel="Close wallpaper picker"
          onPress={onClose}
          style={styles.closeBtn}
        >
          <Text style={styles.closeText}>Done</Text>
        </Pressable>
      )}
      footer={(
        <View style={styles.actions}>
          <Pressable
            accessibilityLabel="Reset wallpaper to default"
            onPress={handleReset}
            style={styles.resetBtn}
          >
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Apply wallpaper"
            onPress={handleApply}
            style={styles.applyBtn}
          >
            <Text style={styles.applyText}>Apply</Text>
          </Pressable>
        </View>
      )}
    >
      {/* Live preview */}
      <View style={styles.preview}>
        <Image
          source={
            draft.source.kind === 'custom'
              ? { uri: draft.source.uri }
              : presetSource(draft.source.id)
          }
          style={styles.previewImg}
          resizeMode="cover"
        />
        <View style={[styles.previewDim, { backgroundColor: `rgba(${colors.dimRgb},${draft.dim})` }]} />
        <View style={styles.previewLabel}>
          <Text style={styles.previewLabelText}>Preview</Text>
        </View>
      </View>

      {/* Dimming adjustment */}
      <View style={styles.dimRow}>
        <Text style={styles.dimLabel}>Dim</Text>
        <View style={styles.dimControls}>
          {[0.2, 0.35, 0.5, 0.65].map((d) => (
            <Pressable
              key={d}
              onPress={() => setDraft((prev) => ({ ...prev, dim: d }))}
              style={[styles.dimOption, draft.dim === d && styles.dimOptionActive]}
            >
              <Text style={styles.dimOptionText}>{Math.round(d * 100)}%</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Built-in presets */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.presets}>
        {PRESET_IDS.map((id) => (
          <Pressable
            key={id}
            onPress={() => setDraft({ source: { kind: 'preset', id }, dim: draft.dim })}
            style={[styles.preset, draft.source.kind === 'preset' && draft.source.id === id && styles.presetActive]}
          >
            <Image source={presetSource(id)} style={styles.presetImg} resizeMode="cover" />
            <Text style={styles.presetName}>{id}</Text>
          </Pressable>
        ))}
        <Pressable
          onPress={handlePickCustom}
          style={styles.preset}
          disabled={picking}
        >
          {picking ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <View style={styles.presetImg}>
              <Text style={styles.presetAdd}>+</Text>
            </View>
          )}
          <Text style={styles.presetName}>Photo</Text>
        </Pressable>
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </BottomSheet>
  );
}

const styles = themedStyles(() => ({
  closeBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  closeText: { ...typography.body, color: colors.primary },
  preview: {
    height: 180,
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  previewImg: {
    ...(StyleSheet.absoluteFill as object),
    width: '100%',
    height: '100%',
  },
  previewDim: {
    ...(StyleSheet.absoluteFill as object),
  },
  previewLabel: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.md,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  previewLabelText: { ...typography.caption, color: colors.text },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  dimLabel: { ...typography.label, color: colors.textMuted },
  dimControls: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dimOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.bgSurface,
  },
  dimOptionActive: {
    backgroundColor: colors.primary,
  },
  dimOptionText: { ...typography.caption, color: colors.text },
  presets: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  preset: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgSurface,
  },
  presetImg: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  presetActive: {
    borderWidth: 2,
    borderColor: colors.primary,
  },
  presetName: {
    ...typography.caption,
    color: colors.text,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  presetAdd: { ...typography.h2, color: colors.textMuted },
  error: { ...typography.bodySmall, color: colors.dangerText, marginBottom: spacing.md },
  resetBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  resetText: { ...typography.body, color: colors.text },
  applyBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
  },
  applyText: { ...typography.body, color: colors.textOnPrimary, fontWeight: '600' },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
}));
