/**
 * Expo config plugin: add the Millo Quick Settings kill-switch tile.
 *
 * TileService runs without the React Native runtime, so it toggles a shared
 * file in the app's files directory. The JS guardrails store (`guardrails.ts`)
 * reads and writes the same file, and adopts tile changes when the app becomes
 * active again. This keeps one global state without a backend or bridge.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const TILE_CLASS = 'MilloKillSwitchTileService';

function tileServiceSource(appPackage) {
  return `package ${appPackage};

import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class ${TILE_CLASS} extends TileService {
  private static final String KILL_SWITCH_FILE = "kill-switch";

  private boolean isPaused() {
    File file = new File(getFilesDir(), KILL_SWITCH_FILE);
    if (!file.exists()) return false;
    try (BufferedReader reader = new BufferedReader(
        new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
      String line = reader.readLine();
      return line != null && line.trim().equals("1");
    } catch (Exception ignored) {
      return false;
    }
  }

  private void setPaused(boolean paused) {
    try (FileOutputStream out = openFileOutput(KILL_SWITCH_FILE, MODE_PRIVATE)) {
      out.write((paused ? "1" : "0").getBytes(StandardCharsets.UTF_8));
    } catch (Exception ignored) {
      // The tile still reflects the previous state if the write fails.
    }
  }

  private void updateTile() {
    Tile tile = getQsTile();
    if (tile == null) return;
    boolean paused = isPaused();
    tile.setState(paused ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
    tile.setLabel(paused ? "Millo paused" : "Millo active");
    tile.setContentDescription(paused
        ? "Millo agent is paused. Tap to resume."
        : "Millo agent is active. Tap to pause.");
    tile.updateTile();
  }

  @Override
  public void onStartListening() {
    super.onStartListening();
    updateTile();
  }

  @Override
  public void onClick() {
    super.onClick();
    setPaused(!isPaused());
    updateTile();
  }
}
`;
}

module.exports = function withKillSwitchTile(config) {
  const appPackage = config.android && config.android.package;
  if (!appPackage) {
    throw new Error('withKillSwitchTile: android.package is required');
  }

  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application &&
      cfg.modResults.manifest.application[0];
    if (!application) {
      throw new Error('withKillSwitchTile: could not find <application>');
    }
    application.service = application.service || [];
    if (!application.service.some(
      (service) => service.$['android:name'] === `.${TILE_CLASS}`,
    )) {
      application.service.push({
        $: {
          'android:name': `.${TILE_CLASS}`,
          'android:exported': 'true',
          'android:icon': '@android:drawable/ic_lock_power_off',
          'android:label': 'Millo pause',
          'android:permission': 'android.permission.BIND_QUICK_SETTINGS_TILE',
        },
        'intent-filter': [
          {
            action: [
              {
                $: {
                  'android:name': 'android.service.quicksettings.action.QS_TILE',
                },
              },
            ],
          },
        ],
      });
    }
    return cfg;
  });

  return withDangerousMod(config, [
    'android',
    (cfg) => {
      const packagePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/java',
        ...appPackage.split('.'),
      );
      fs.mkdirSync(packagePath, { recursive: true });
      fs.writeFileSync(
        path.join(packagePath, `${TILE_CLASS}.java`),
        tileServiceSource(appPackage),
      );
      return cfg;
    },
  ]);
};
