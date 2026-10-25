// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // The compiler-era react-hooks rules flag long-standing, working patterns
      // here: ref access during render for Animated initializers, and
      // set-state-in-effect for external-store subscriptions (sync singletons).
      // Downgraded to warnings until the screens get a useSyncExternalStore pass.
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: ["dist/*"],
  }
]);
