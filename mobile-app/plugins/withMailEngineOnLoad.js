/**
 * Expo config plugin: preload the MailEngine Nitro C++ library at app start.
 *
 * `react-native-mail-engine` is a pure Nitro module with no `*Package` class,
 * so nothing in the app ever calls `System.loadLibrary("MailEngine")`. The
 * library's `JNI_OnLoad` (added by `scripts/patch-mail-engine.js`) is what
 * registers the "MailEngine" HybridObject in Nitro's HybridObjectRegistry —
 * if the library is never loaded, mail sync fails at runtime with:
 *
 *   Cannot create an instance of HybridObject "MailEngine" - It has not yet
 *   been registered in the Nitro Modules HybridObjectRegistry!
 *
 * This plugin injects a `System.loadLibrary("MailEngine")` call into
 * `MainApplication.onCreate()` — before `loadReactNative(...)` — so the
 * registration happens before any JS can touch the mail bridge. It runs on
 * every `expo prebuild`, so it survives `--clean` regenerations in CI.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'System.loadLibrary("MailEngine")';

const LOAD_BLOCK = [
  '    // MailEngine (Nitro) must be preloaded before React Native starts:',
  '    // its JNI_OnLoad registers the "MailEngine" HybridObject in Nitro\'s',
  '    // HybridObjectRegistry. Without this, mail sync fails with',
  '    // "Cannot create an instance of HybridObject \\"MailEngine\\"".',
  '    try {',
  '        System.loadLibrary("MailEngine")',
  '    } catch (e: Throwable) {',
  '        android.util.Log.e("MailEngineOnLoad", "Failed to preload MailEngine native library", e)',
  '    }',
  '',
].join('\n');

module.exports = function withMailEngineOnLoad(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const platformRoot = cfg.modRequest.platformProjectRoot; // <project>/android
      const pkg = (cfg.android && cfg.android.package) || 'com.threadmymail.app';
      const mainApp = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'java',
        ...pkg.split('.'),
        'MainApplication.kt',
      );

      if (!fs.existsSync(mainApp)) {
        throw new Error(
          `withMailEngineOnLoad: MainApplication.kt not found at ${mainApp}`,
        );
      }

      let contents = fs.readFileSync(mainApp, 'utf8');
      if (contents.includes(MARKER)) {
        // Already patched (idempotent).
        return cfg;
      }

      const anchor = 'super.onCreate()';
      const idx = contents.indexOf(anchor);
      if (idx === -1) {
        throw new Error(
          'withMailEngineOnLoad: could not find `super.onCreate()` in MainApplication.kt',
        );
      }
      const insertAt = contents.indexOf('\n', idx) + 1;
      contents = contents.slice(0, insertAt) + LOAD_BLOCK + contents.slice(insertAt);
      fs.writeFileSync(mainApp, contents);
      return cfg;
    },
  ]);
};
