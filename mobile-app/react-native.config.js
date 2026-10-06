/**
 * App-level React Native autolinking overrides.
 *
 * `react-native-mail-engine` is a pure Nitro module: it ships no
 * `*Package.{java,kt}` class (it registers hybrid objects via JNI at load
 * time), so both Expo autolinking and the RN community CLI skip it — the
 * module would be silently absent from the APK. This override forces it into
 * the Gradle build by declaring its android source dir explicitly.
 *
 * The `sourceDir` + `packageImportPath`/`packageInstance` fields are what the
 * resolver needs to emit the `include` + `implementation project(...)` lines.
 * The package class name is resolved from the module's own manifest/gradle.
 */
module.exports = {
  dependencies: {
    'react-native-mail-engine': {
      platforms: {
        android: {
          sourceDir: 'node_modules/react-native-mail-engine/android',
        },
      },
    },
  },
};
