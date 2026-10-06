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

const target = path.join(
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

try {
  let src = fs.readFileSync(target, 'utf8');
  if (src.includes('std::optional<bool> isInline')) {
    console.log('[patch] mail-engine inline field already patched');
    process.exit(0);
  }
  // Rename the C++ identifier `inline` -> `isInline` only where it is used as
  // a field/parameter identifier, never inside the "inline" string literals.
  const patched = src
    .replace('std::optional<bool> inline     SWIFT_PRIVATE;', 'std::optional<bool> isInline     SWIFT_PRIVATE;')
    .replace(
      'std::optional<bool> inline): filename(filename), mimeType(mimeType), path(path), data(data), contentId(contentId), inline(inline) {}',
      'std::optional<bool> isInline): filename(filename), mimeType(mimeType), path(path), data(data), contentId(contentId), isInline(isInline) {}',
    )
    .replace(
      'JSIConverter<std::optional<bool>>::toJSI(runtime, arg.inline));',
      'JSIConverter<std::optional<bool>>::toJSI(runtime, arg.isInline));',
    );
  if (patched === src) {
    console.warn('[patch] mail-engine inline field: no expected patterns found — manual check needed');
    process.exit(1);
  }
  fs.writeFileSync(target, patched);
  console.log('[patch] mail-engine inline field renamed to isInline');
} catch (err) {
  console.error('[patch] failed to patch mail-engine:', err.message);
  process.exit(1);
}
