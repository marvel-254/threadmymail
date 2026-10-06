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

if (!sharedOk || !jniOk) {
  process.exit(1);
}

