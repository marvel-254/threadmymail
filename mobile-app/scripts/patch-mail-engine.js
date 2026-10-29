/**
 * Postinstall patch for `react-native-mail-engine`.
 *
 * The package's Nitrogen-generated C++ header uses `inline` as a struct field
 * name (`MailOutgoingAttachment.inline`). `inline` is a reserved C++ keyword,
 * so the Android build fails with:
 *
 *   error: 'inline' can only appear on functions and non-local variables
 *
 * This script renames the C++ field identifier to `isInline` while keeping the
 * JS wire property name `"inline"` untouched (that is what the JS API sends).
 * It is idempotent: if the field is already `isInline`, it does nothing.
 */
const fs = require('fs');
const path = require('path');

const SHARED = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-mail-engine',
  'nitrogen',
  'generated',
  'shared',
  'c++',
  'MailOutgoingAttachment.hpp',
);

const JNI = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-mail-engine',
  'nitrogen',
  'generated',
  'android',
  'c++',
  'JMailOutgoingAttachment.hpp',
);

function patchFile(target, replacements, label) {
  try {
    let src = fs.readFileSync(target, 'utf8');
    let patched = src;
    for (const [from, to] of replacements) {
      patched = patched.split(from).join(to);
    }
    if (patched === src) {
      console.log(`[patch] ${label}: already patched or no changes`);
      return true;
    }
    fs.writeFileSync(target, patched);
    console.log(`[patch] ${label}: patched`);
    return true;
  } catch (err) {
    console.error(`[patch] failed to patch ${label}:`, err.message);
    return false;
  }
}

// Shared header: rename the C++ field `inline` -> `isInline`.
const sharedOk = patchFile(
  SHARED,
  [
    ['std::optional<bool> inline     SWIFT_PRIVATE;', 'std::optional<bool> isInline     SWIFT_PRIVATE;'],
    [
      'std::optional<bool> inline): filename(filename), mimeType(mimeType), path(path), data(data), contentId(contentId), inline(inline) {}',
      'std::optional<bool> isInline): filename(filename), mimeType(mimeType), path(path), data(data), contentId(contentId), isInline(isInline) {}',
    ],
    [
      'JSIConverter<std::optional<bool>>::toJSI(runtime, arg.inline));',
      'JSIConverter<std::optional<bool>>::toJSI(runtime, arg.isInline));',
    ],
  ],
  'MailOutgoingAttachment.hpp',
);

// JNI bridge: rename the C++ local var `inline` -> `inlineValue`.
// The Java field name string "inline" is untouched.
const jniOk = patchFile(
  JNI,
  [
    ['jni::local_ref<jni::JBoolean> inline = this->getFieldValue(fieldInline);', 'jni::local_ref<jni::JBoolean> inlineValue = this->getFieldValue(fieldInline);'],
    [
      'inline != nullptr ? std::make_optional(static_cast<bool>(inline->value())) : std::nullopt',
      'inlineValue != nullptr ? std::make_optional(static_cast<bool>(inlineValue->value())) : std::nullopt',
    ],
    [
      'value.inline.has_value() ? jni::JBoolean::valueOf(value.inline.value()) : nullptr',
      'value.isInline.has_value() ? jni::JBoolean::valueOf(value.isInline.value()) : nullptr',
    ],
  ],
  'JMailOutgoingAttachment.hpp',
);

// ---------------------------------------------------------------------------
// Nitro registration fix (JNI_OnLoad)
// ---------------------------------------------------------------------------
// The published package never calls `registerAllNatives()`: its CMake project
// compiles only the nitrogen-generated sources, and nothing provides the
// `JNI_OnLoad` entry point that Nitro requires (nitro.margelo.com → "call the
// C++/JNI registerAllNatives() function inside your library's JNI_OnLoad(...)
// entry point, often in cpp-adapter.cpp"). Nothing loads libMailEngine.so
// either (the module ships no *Package class), so the "MailEngine"
// HybridObject never lands in Nitro's HybridObjectRegistry and every mail
// operation fails at runtime with:
//
//   Cannot create an instance of HybridObject "MailEngine" - It has not yet
//   been registered in the Nitro Modules HybridObjectRegistry!
//
// Fix (both halves):
//   1. Here: ship a cpp-adapter.cpp exporting JNI_OnLoad that calls
//      registerAllNatives(), and compile it into libMailEngine.so.
//   2. In the app: preload the library in MainApplication.onCreate (see
//      plugins/withMailEngineOnLoad.js) so registration runs before any JS
//      calls NitroModules.createHybridObject('MailEngine').

const CMAKE = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-mail-engine',
  'android',
  'CMakeLists.txt',
);
const ADAPTER = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-mail-engine',
  'android',
  'cpp-adapter.cpp',
);

const ADAPTER_SRC = `//
// cpp-adapter.cpp — JNI entry point for the MailEngine Nitro library.
//
// Added by ThreadMyMail's postinstall patch (scripts/patch-mail-engine.js).
// The published package builds only the nitrogen-generated sources and never
// exports JNI_OnLoad, so registerAllNatives() never runs and the "MailEngine"
// HybridObject is missing from Nitro's HybridObjectRegistry at runtime.
// See https://nitro.margelo.com/docs/getting-started/how-to-build-a-nitro-module
// ("call the C++/JNI registerAllNatives() function inside your library's
// JNI_OnLoad(...) entry point").
//

#include <fbjni/fbjni.h>

#include "../nitrogen/generated/android/MailEngineOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::mailengine::registerAllNatives();
  });
}
`;

function writeAdapter() {
  try {
    const existing = fs.existsSync(ADAPTER) ? fs.readFileSync(ADAPTER, 'utf8') : '';
    if (existing === ADAPTER_SRC) {
      console.log('[patch] cpp-adapter.cpp: already up to date');
      return true;
    }
    fs.writeFileSync(ADAPTER, ADAPTER_SRC);
    console.log('[patch] cpp-adapter.cpp: written (JNI_OnLoad → registerAllNatives)');
    return true;
  } catch (err) {
    console.error('[patch] failed to write cpp-adapter.cpp:', err.message);
    return false;
  }
}

function patchCmake() {
  try {
    const src = fs.readFileSync(CMAKE, 'utf8');
    if (src.includes('cpp-adapter.cpp')) {
      console.log('[patch] CMakeLists.txt: already includes cpp-adapter.cpp');
      return true;
    }
    // Compile the JNI entry point into libMailEngine.so.
    const patched = src.replace(
      'add_library(MailEngine SHARED)',
      'add_library(MailEngine SHARED cpp-adapter.cpp)',
    );
    if (patched === src) {
      console.error('[patch] CMakeLists.txt: could not find `add_library(MailEngine SHARED)`');
      return false;
    }
    fs.writeFileSync(CMAKE, patched);
    console.log('[patch] CMakeLists.txt: added cpp-adapter.cpp to libMailEngine sources');
    return true;
  } catch (err) {
    console.error('[patch] failed to patch CMakeLists.txt:', err.message);
    return false;
  }
}

const adapterOk = writeAdapter();
const cmakeOk = patchCmake();

if (!sharedOk || !jniOk || !adapterOk || !cmakeOk) {
  process.exit(1);
}

