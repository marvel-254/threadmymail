/**
 * Wallpaper system — global default + per-conversation overrides.
 *
 * Spec §7: wallpaper applies behind the chat messages only; app bar, nav,
 * drawer, and composer keep their own legible surfaces. Precedence:
 * conversation override > global default. Persist on-device.
 *
 * Built-in presets are bundled local assets (no external URLs). Custom images
 * are picked via the Android system Photo Picker (expo-image-picker), validated,
 * downscaled, and copied into app storage (content URIs are revocable).
 */
import * as SecureStore from 'expo-secure-store';
import { documentDirectory } from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';

const GLOBAL_KEY = 'threadmymail.wallpaper.global.v1';
const CUSTOM_DIR = 'wallpapers/';
const MAX_CUSTOM_BYTES = 10 * 1024 * 1024; // ~10 MB
const MAX_DIMENSION = 1600; // downscale target (screen resolution + headroom)

const DOC_DIR = documentDirectory ?? Paths.document.uri;

export type WallpaperPresetId = 'default' | 'plain' | 'linen' | 'midnight' | 'landscape';

export type WallpaperSource =
  | { kind: 'preset'; id: WallpaperPresetId }
  | { kind: 'custom'; uri: string };

export type WallpaperSetting = {
  source: WallpaperSource;
  dim: number; // 0..1 readability overlay opacity
};

export const PRESET_IDS: WallpaperPresetId[] = ['default', 'plain', 'linen', 'midnight', 'landscape'];

export const DEFAULT_WALLPAPER: WallpaperSetting = {
  source: { kind: 'preset', id: 'default' },
  dim: 0.35,
};

/** Resolve a preset id to a bundled asset source. */
export function presetSource(id: WallpaperPresetId): number {
  switch (id) {
    case 'default':
      return require('../assets/app-background.png');
    case 'plain':
      return require('../assets/wallpaper-plain.png');
    case 'linen':
      return require('../assets/wallpaper-linen.png');
    case 'midnight':
      return require('../assets/wallpaper-midnight.png');
    case 'landscape':
      return require('../assets/wallpaper-landscape.png');
  }
}

/** Serialize a setting for storage. */
function serialize(setting: WallpaperSetting): string {
  return JSON.stringify(setting);
}

function parse(raw: string | null): WallpaperSetting | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WallpaperSetting;
    if (!parsed.source || typeof parsed.dim !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Read the global default wallpaper setting. */
export async function getGlobalWallpaper(): Promise<WallpaperSetting> {
  try {
    const raw = await SecureStore.getItemAsync(GLOBAL_KEY);
    return parse(raw) ?? DEFAULT_WALLPAPER;
  } catch {
    return DEFAULT_WALLPAPER;
  }
}

/** Persist the global default wallpaper setting. */
export async function setGlobalWallpaper(setting: WallpaperSetting): Promise<void> {
  try {
    await SecureStore.setItemAsync(GLOBAL_KEY, serialize(setting));
  } catch {
    // Non-fatal: worst case the global default resets next launch.
  }
}

/** Resolve the effective wallpaper for a conversation (override > global). */
export async function resolveWallpaper(
  override: string | null | undefined,
): Promise<WallpaperSetting> {
  if (override) {
    const parsed = parse(override);
    if (parsed) return parsed;
  }
  return getGlobalWallpaper();
}

/** Serialize a wallpaper override for the conversation store. */
export function serializeOverride(setting: WallpaperSetting): string {
  return serialize(setting);
}

/**
 * Pick a custom image via the system Photo Picker, validate, downscale, and
 * copy it into app storage. Returns the local file URI, or null if cancelled.
 * Throws a descriptive Error for unsupported/oversized files.
 */
export async function pickCustomWallpaper(): Promise<string | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo access was not granted. Enable it in system settings to use a custom wallpaper.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  });

  if (result.canceled || result.assets.length === 0) {
    return null;
  }

  const asset = result.assets[0];
  if (!asset.uri) {
    throw new Error('Could not read the selected image.');
  }

  // Validate size (best-effort; content URIs may not expose size directly).
  try {
    const file = new File(asset.uri);
    const info = file.info();
    if (info.exists && info.size && info.size > MAX_CUSTOM_BYTES) {
      throw new Error('Image is too large (max ~10 MB). Choose a smaller photo.');
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('too large')) throw e;
    // Size unknown — proceed; downscale below keeps memory bounded.
  }

  // Downscale to a bounded dimension and copy into app storage.
  const manipulated = await ImageManipulator.manipulateAsync(
    asset.uri,
    [{ resize: { width: MAX_DIMENSION } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );

  const customDir = new Directory(Paths.document, CUSTOM_DIR);
  customDir.create({ intermediates: true, idempotent: true });

  const filename = `custom_${Date.now()}.jpg`;
  const dest = new File(customDir, filename);
  await new File(manipulated.uri).copy(dest, { overwrite: true });

  return dest.uri;
}

/** Delete a custom wallpaper file (used when resetting to free storage). */
export async function deleteCustomWallpaper(uri: string): Promise<void> {
  try {
    if (uri.startsWith(DOC_DIR)) {
      const file = new File(uri);
      file.delete();
    }
  } catch {
    // Non-fatal: orphaned file is harmless.
  }
}
