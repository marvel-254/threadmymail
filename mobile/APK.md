# ThreadMyMail - Android APK Build Guide

> React Native + Expo for Android APK with push notifications.

---

## 1. Tech Stack

- **React Native** + **Expo** (managed workflow)
- **React Navigation** (stack + tabs)
- **TanStack Query** (server state)
- **NativeWind** (Tailwind for React Native)
- **MMKV** (fast local storage)
- **Expo Notifications** (push)
- **EAS Build** (build pipeline)
- **Expo Router** (file-based routing)

---

## 2. Project Setup

### Initialize Expo Project
```bash
# Create project
npx create-expo-app ThreadMyMail
cd ThreadMyMail

# Install dependencies
npm install @react-navigation/native @react-navigation/native-stack
npm install react-native-screens react-native-safe-area-context
npm install react-query @tanstack/react-query
npm install react-native-mmkv
npm install nativewind
npm install @expo/vector-icons
npm install expo-notifications
npm install expo-secure-store
npm install expo-linking
npm install axios
npm install zustand

# Install development dependencies
npm install -D @types/react-native
npm install -D tailwindcss
```

### Nativewind Config
```javascript
// tailwind.config.js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { 50: '#eff6ff', 500: '#3b82f6', 900: '#1e3a8a' },
        dark: { 100: '#f1f5f9', 900: '#0f172a' }
      }
    }
  }
};
```

### MMKV Setup
```javascript
// lib/storage.js
import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV({
  id: 'threadmymail',
});

export const storageHelpers = {
  set: (key, value) => storage.set(key, value),
  get: (key) => storage.getString(key),
  delete: (key) => storage.delete(key),
};
```

---

## 3. App Structure

```
threadmymail/
├── app/
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── magic-link.tsx
│   ├── (tabs)/
│   │   ├── index.tsx         # Inbox list
│   │   ├── thread.tsx        # Thread view
│   │   ├── compose.tsx       # Compose email
│   │   ├── chat.tsx          # AI chat
│   │   └── settings.tsx      # Settings
│   └── _layout.tsx           # Root layout
├── components/
│   ├── EmailList.tsx
│   ├── EmailItem.tsx
│   ├── ThreadView.tsx
│   ├── ComposeModal.tsx
│   ├── AIBubble.tsx
│   ├── AccountSelector.tsx
│   ├── NotificationBadge.tsx
│   └── Settings/
│       ├── AIProvider.tsx
│       ├── NotificationPrefs.tsx
│       └── AccountManager.tsx
├── hooks/
│   ├── useEmail.ts
│   ├── useAI.ts
│   ├── useNotifications.ts
│   └── useAccounts.ts
├── lib/
│   ├── storage.ts            # MMKV storage
│   ├── api.ts                # API client
│   ├── ai.ts                 # AI helpers
│   └── notifications.ts      # Push notification handlers
├── types/
│   ├── email.ts
│   ├── user.ts
│   └── notification.ts
├── app.json                  # Expo config
└── app.config.ts             # Dynamic config
```

---

## 4. Key Components

### App Configuration (app.config.ts)
```typescript
import { ApplicationConfig } from 'expo';

export default {
  expo: {
    name: 'ThreadMyMail',
    slug: 'threadmymail',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#ffffff',
    },
    updates: {
      fallbackToCacheTimeout: 0,
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.threadmymail.ios',
    },
    android: {
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        backgroundColor: '#3b82f6',
      },
      package: 'com.threadmymail.android',
      permissions: [
        'android.permission.INTERNET',
        'android.permission.VIBRATE',
        'android.permission.RECEIVE_BOOT_COMPLETED',
      ],
    },
    plugins: [
      'expo-notifications',
      [
        'expo-build-properties',
        { android: { minSdkVersion: 23 } },
      ],
    ],
  },
};
```

### Authentication (app/(auth)/login.tsx)
```typescript
import { useState } from 'react';
import { View, TextInput, Button, Text } from 'react-native';
import { useAuthStore } from '@/lib/storage';
import { api } from '@/lib/api';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');

  const sendMagicLink = async () => {
    try {
      setStatus('Sending magic link...');
      await api.post('/auth/magic-link', { email });
      setStatus('Check your email for the login link');
    } catch (error) {
      setStatus('Failed to send magic link');
    }
  };

  return (
    <View className="flex-1 p-6 justify-center bg-white dark:bg-dark-900">
      <Text className="text-3xl font-bold text-center mb-8 text-primary-900 dark:text-white">
        ThreadMyMail
      </Text>
      
      <TextInput
        placeholder="Enter your email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        className="border border-gray-300 rounded-lg p-3 mb-4"
      />
      
      <Button 
        title="Send Magic Link" 
        onPress={sendMagicLink}
        color="#3b82f6"
      />
      
      {status ? (
        <Text className="mt-4 text-center text-gray-600">{status}</Text>
      ) : null}
    </View>
  );
}
```

---

## 5. Push Notifications Setup

### Register for Push Token
```typescript
// lib/notifications.ts
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { storage } from './storage';

// Configure notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications() {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  
  if (finalStatus !== 'granted') {
    console.error('Push notification permission denied');
    return null;
  }

  // Get Expo push token
  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PROJECT_ID,
  })).data;

  // Store token
  storage.set('pushToken', token);

  // Send token to backend
  try {
    await fetch(`${process.env.API_URL}/notifications/push-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch (error) {
    console.error('Failed to register push token:', error);
  }

  return token;
}
```

### Handle Incoming Notifications
```typescript
// Listen for notifications
Notifications.addNotificationReceivedListener((notification) => {
  console.log('Notification received:', notification.request.content);
  
  // Update UI (e.g., mark email as important)
  const data = notification.request.content.data;
  if (data?.email_id) {
    // Handle email notification
    store.set('lastNotification', notification);
  }
});

// Handle notification tap (when app is in foreground)
Notifications.addNotificationResponseReceivedListener((response) => {
  const data = response.notification.request.content.data;
  
  if (data?.email_id) {
    // Navigate to email thread
    router.push(`/thread/${data.email_id}`);
  }
});
```

### Notification Settings UI
```typescript
// components/Settings/NotificationPrefs.tsx
export default function NotificationPrefs() {
  const [dailyDigest, setDailyDigest] = useState(true);
  const [importantPush, setImportantPush] = useState(true);
  const [digestTime, setDigestTime] = useState('20:00');

  return (
    <View className="p-4">
      <Text className="text-lg font-semibold mb-4">Notifications</Text>
      
      <View className="flex-row items-center justify-between mb-4">
        <Text>Daily Digest</Text>
        <Switch value={dailyDigest} onValueChange={setDailyDigest} />
      </View>
      
      <View className="flex-row items-center justify-between mb-4">
        <Text>Important Emails (Push)</Text>
        <Switch value={importantPush} onValueChange={setImportantPush} />
      </View>
      
      <View className="mb-4">
        <Text>Digest Time</Text>
        <TimePicker value={digestTime} onChange={setDigestTime} />
      </View>
    </View>
  );
}
```

---

## 6. Building the APK

### EAS Build Setup
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to Expo
eas login

# Initialize EAS in project
eas init

# Configure build profiles
```

### eas.json
```json
{
  "cli": {
    "version": ">= 5.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "gradleCommand": ":app:assembleRelease"
      }
    },
    "production": {
      "android": {
        "gradleCommand": ":app:assembleRelease"
      },
      "autoIncrement": true
    }
  },
  "submit": {
    "production": {
      "android": {
        "track": "internal"
      }
    }
  }
}
```

### Build Commands
```bash
# Development build (expo Go)
eas build --platform android --profile development

# Preview build (APK for testing)
eas build --platform android --profile preview

# Production build (signed APK)
eas build --platform android --profile production

# Build locally (requires Android SDK)
eas build --platform android --local

# View build status
eas build:list

# Download APK
eas build:download <build-id>
```

### Local Build (No EAS)
```bash
# Install dependencies
npx expo install

# Build APK (requires Android SDK)
npx expo run:android

# This generates:
# android/app/build/outputs/apk/release/app-release.apk
```

---

## 7. APK Signing

### Generate Keystore (First Time)
```bash
keytool -genkeypair -v \
  -keystore ~/threadmymail.keystore \
  -alias threadmymail \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

### Configure Signing (EAS)
```bash
# Add signing key to EAS
eas credentials:upload --platform android

# Or configure in eas.json:
{
  "build": {
    "production": {
      "android": {
        "gradleCommand": ":app:assembleRelease",
        "signingCertificateFingerprintSha256": "XX:XX:XX..."
      }
    }
  }
}
```

---

## 8. Testing Checklist

### Functional Tests
- [ ] Magic link login works
- [ ] Email account connects (IMAP/SMTP)
- [ ] Inbox syncs correctly
- [ ] Email reading works
- [ ] Compose + send works
- [ ] AI summarize button works
- [ ] AI compose button works
- [ ] Push notifications arrive
- [ ] Offline mode (cached emails)
- [ ] Settings persist (theme, notifications)

### UI Tests
- [ ] Inbox list scrolls smoothly
- [ ] Thread view renders correctly
- [ ] Compose modal is usable
- [ ] Settings screen accessible
- [ ] Dark/light theme switches
- [ ] Landscape mode supported
- [ ] Small screens supported

### Performance Tests
- [ ] Initial load < 3 seconds
- [ ] Email list pagination smooth
- [ ] Search is instant
- [ ] Push notification latency < 5 seconds
- [ ] Battery usage acceptable
- [ ] Memory usage < 200MB

### Security Tests
- [ ] Magic link expires correctly
- [ ] JWT refresh works
- [ ] API key encrypted in storage
- [ ] No sensitive data in logs
- [ ] HTTPS enforced

---

## 9. Publishing Options

### Internal Testing (Free)
- Share APK directly via file transfer
- Install via `adb install app.apk`
- Use Expo Go for testing

### Google Play Store
- Create Google Play Developer account ($25 one-time)
- Generate signed APK
- Upload to Play Console
- Target: `internal testing` track

### Direct Distribution
- Share APK via email/cloud
- Users enable "Install from Unknown Sources"
- Provide update instructions

---

## 10. Common Issues

### "Your device is not compatible" Error
```bash
# Check Android version
# Minimum SDK: 23 (Android 6.0)
# Target SDK: 33+ (Android 13+)
```

### Push Notifications Not Working
```bash
# Verify Expo project ID
# Check permissions (ask again)
# Test on physical device (not emulator)
# Ensure app has notification permission
```

### APK Too Large
```bash
# Enable ProGuard (minification)
# Remove unused assets
# Use vector images (SVG) instead of PNG
```

---

## 11. Future Enhancements

### Native Modules (if needed)
- [ ] Calendar integration
- [ ] File picker for attachments
- [ ] Biometric auth (fingerprint/face)
- [ ] Widget (inbox count)
- [ ] Share extension (share email to app)

### Performance Optimizations
- [ ] Virtualized list for emails
- [ ] Image caching
- [ ] Lazy loading threads
- [ ] Background sync
- [ ] Offline-first architecture

---

## 12. APK Size Breakdown (Estimated)

| Component | Size |
|-----------|------|
| Expo Runtime | ~20 MB |
| React Native + NativeWind | ~15 MB |
| MMKV + Storage | ~5 MB |
| Notification Assets | ~2 MB |
| Your Code | ~1 MB |
| **Total** | **~43 MB** |

---

## 13. Quick Start Commands

```bash
# 1. Create project
npx create-expo-app ThreadMyMail
cd ThreadMyMail

# 2. Install dependencies
npm install react-native-screens react-native-safe-area-context @react-navigation/native @react-navigation/native-stack @tanstack/react-query react-native-mmkv nativewind axios expo-notifications expo-secure-store expo-linking

# 3. Start development server
npx expo start

# 4. Build preview APK
eas build --platform android --profile preview

# 5. Build production APK
eas build --platform android --profile production
```

---

*Android APK build guide for ThreadMyMail*
*Last updated: 2026-09-27*