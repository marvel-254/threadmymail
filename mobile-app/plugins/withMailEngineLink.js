/**
 * Expo config plugin: link `react-native-mail-engine` into the Android build.
 *
 * Why this exists: `react-native-mail-engine` is a pure Nitro module. It ships
 * no `*Package.{java,kt}` class (its hybrid objects register via JNI at load
 * time), so neither Expo autolinking nor the RN community CLI emits an
 * `include` for it — the module would be silently absent from the APK and
 * `MailEngine.connect()` would fail at runtime.
 *
 * This plugin appends the missing `include` to `settings.gradle` so the module
 * is compiled into the app. The module's own `android/build.gradle` declares
 * its dependency on `:react-native-nitro-modules`, which autolinks normally.
 */
const { withSettingsGradle } = require('@expo/config-plugins');

const MAIL_ENGINE_INCLUDE = `\n// react-native-mail-engine (pure Nitro module — no Package class, so\n// autolinking skips it; included explicitly by plugins/withMailEngineLink.js)\ninclude ':react-native-mail-engine'\nproject(':react-native-mail-engine').projectDir = new File(rootDir, '../node_modules/react-native-mail-engine/android')\n`;

module.exports = function withMailEngineLink(config) {
  return withSettingsGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (!contents.includes("':react-native-mail-engine'")) {
      cfg.modResults.contents = contents + MAIL_ENGINE_INCLUDE;
    }
    return cfg;
  });
};
