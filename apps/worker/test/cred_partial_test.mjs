// A single undecryptable row must not hide every other stored credential.
//
// Regression: a dev-only row (sealed with the local ENCRYPTION_KEY) reached the
// shared database. `status()` let that one throw, and the route's catch blanked
// the whole list — so a user with a perfectly good key was told they had none,
// with no way to tell "wrong key" from "never set one".
import assert from 'node:assert';

const KEY_GOOD = 'prod-key-that-decrypts-everything';
const KEY_OTHER = 'a-different-key-entirely';

let p = 0, f = 0;
const t = (name, fn) => {
  try { fn(); p++; console.log('  ok   ' + name); }
  catch (e) { f++; console.log('  FAIL ' + name + '\n        ' + e.message); }
};

// Real AES-GCM, same construction as src/agent/crypto.ts.
const digest = (secret) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
const b64 = (buf) => Buffer.from(buf).toString('base64url');

async function seal(plain, secret) {
  const key = await crypto.subtle.importKey('raw', await digest(secret), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}

async function cryptoOpen(stored, secret) {
  const [v, iv, ct] = stored.split('.');
  if (v !== 'v1') throw new Error('unsupported version');
  const key = await crypto.subtle.importKey('raw', await digest(secret), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: Buffer.from(iv, 'base64url') },
    key,
    Buffer.from(ct, 'base64url'),
  );
  return new TextDecoder().decode(pt);
}

const IDS = ['openrouter', 'anthropic', 'ollama'];
const mkRow = async (provider, key, value, secret) => ({
  plugin_id: `model:${provider}`,
  key,
  value_encrypted: await seal(value, secret),
});

const rows = async (specs) => Promise.all(specs.map(([p, k, v, s]) => mkRow(p, k, v, s)));

/** A faithful reimplementation of the loop in CredentialStore.status(). */
async function status(rows, ids, encryptionKey) {
  const wanted = ids.map((i) => `model:${i}`);
  const slots = new Map(ids.map((i) => [i, {}]));
  let undecryptable = 0;

  for (const row of rows.filter((r) => wanted.includes(r.plugin_id))) {
    const provider = row.plugin_id.slice('model:'.length);
    const slot = slots.get(provider);
    if (!slot) continue;
    let value;
    try {
      value = await cryptoOpen(row.value_encrypted, encryptionKey);
    } catch {
      undecryptable++;
      continue;
    }
    if (row.key === 'api_key') slot.api = value;
    else if (row.key === 'base_url') slot.base = value === '' ? null : value;
  }

  const credentials = ids.map((id) => {
    const s = slots.get(id) ?? {};
    return {
      provider: id,
      has_key: typeof s.api === 'string' && s.api !== '',
      base_url: s.base ?? null,
      fingerprint: s.api ? s.api.slice(-3) : null,
    };
  });
  return { credentials, undecryptable };
}

const byId = (res, id) => res.credentials.find((c) => c.provider === id);

const mixed = await rows([
  ['openrouter', 'api_key', 'sk-or-good', KEY_GOOD],
  ['anthropic', 'api_key', 'sk-ant-good', KEY_GOOD],
  // Sealed with the local dev key: production cannot read it.
  ['ollama', 'base_url', 'http://127.0.0.1:11434', KEY_OTHER],
]);

console.log('\n— one undecryptable row, two good ones —');
const res = await status(mixed, IDS, KEY_GOOD);
t('a good key is still reported', () => {
  assert.equal(byId(res, 'openrouter').has_key, true);
  assert.equal(byId(res, 'openrouter').fingerprint, 'ood');
});
t('a second good key is still reported', () => {
  assert.equal(byId(res, 'anthropic').has_key, true);
});
t('the bad row reads as "not set" rather than exploding', () => {
  assert.equal(byId(res, 'ollama').has_key, false);
  assert.equal(byId(res, 'ollama').base_url, null);
});
t('the failure is counted, not swallowed silently', () => {
  assert.equal(res.undecryptable, 1);
});
t('THE REGRESSION: one bad row does not empty the list', () => {
  assert.equal(res.credentials.length, 3);
  assert.equal(res.credentials.filter((c) => c.has_key).length, 2);
});

console.log('\n— every row decryptable —');
const clean = await status(
  await rows([
    ['openrouter', 'api_key', 'sk-or-good', KEY_GOOD],
    ['anthropic', 'api_key', 'sk-ant-good', KEY_GOOD],
  ]),
  IDS,
  KEY_GOOD,
);
t('nothing is counted when nothing is broken', () => {
  assert.equal(clean.undecryptable, 0);
});
t('the provider with no stored row is simply absent from the result', () => {
  assert.equal(byId(clean, 'ollama').has_key, false);
  assert.equal(byId(clean, 'ollama').fingerprint, null);
});

console.log('\n— a rotated key, everything unreadable —');
const rotated = await status(mixed, IDS, 'yet-another-key');
t('all three are counted, none silently dropped', () => {
  assert.equal(rotated.undecryptable, 3);
});
t('and the list is still well-formed so the UI can render it', () => {
  assert.equal(rotated.credentials.length, 3);
  assert.ok(rotated.credentials.every((c) => c.has_key === false));
});

console.log('\n' + p + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
