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
const { withSettingsGradle, withAppBuildGradle } = require('@expo/config-plugins');

const MAIL_ENGINE_INCLUDE = `\n// react-native-mail-engine (pure Nitro module — no Package class, so\n// autolinking skips it; included explicitly by plugins/withMailEngineLink.js)\ninclude ':react-native-mail-engine'\nproject(':react-native-mail-engine').projectDir = new File(rootDir, '../node_modules/react-native-mail-engine/android')\n`;

const MAIL_ENGINE_DEP = `\n    // react-native-mail-engine (pure Nitro module — linked explicitly; see plugins/withMailEngineLink.js)\n    implementation project(':react-native-mail-engine')\n`;

module.exports = function withMailEngineLink(config) {
  config = withSettingsGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (!contents.includes("':react-native-mail-engine'")) {
      cfg.modResults.contents = contents + MAIL_ENGINE_INCLUDE;
    }
    return cfg;
  });
  config = withAppBuildGradle(config, (cfg) => {
    const contents = cfg.modResults.contents;
    if (!contents.includes("project(':react-native-mail-engine')")) {
      // Insert inside the `dependencies { ... }` block, before its closing brace.
      const depsClose = contents.lastIndexOf('\n}');
      if (depsClose === -1) {
        throw new Error('withMailEngineLink: could not find dependencies block in app/build.gradle');
      }
      cfg.modResults.contents =
        contents.slice(0, depsClose) + MAIL_ENGINE_DEP + contents.slice(depsClose);
    }
    return cfg;
  });
  return config;
};
