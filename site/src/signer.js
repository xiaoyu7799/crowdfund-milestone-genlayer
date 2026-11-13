// Portable encrypted signer backup. Passwords and plaintext keys are never stored.
const iterations = 310000;
async function derive(password, salt, usage) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Use a password of at least 12 characters');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, [usage]);
}
export async function sealKey(key, password) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid private key');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const secret = await derive(password, salt, 'encrypt');
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, secret, new TextEncoder().encode(key));
  return { version: 1, salt: [...salt], iv: [...iv], data: [...new Uint8Array(data)] };
}
export async function openKey(backup, password) {
  if (backup?.version !== 1 || backup.salt?.length !== 16 || backup.iv?.length !== 12 || backup.data?.length !== 82) throw new Error('Invalid signer backup');
  const salt = new Uint8Array(backup.salt), iv = new Uint8Array(backup.iv);
  const secret = await derive(password, salt, 'decrypt');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, secret, new Uint8Array(backup.data));
  const key = new TextDecoder().decode(data);
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('Invalid private key');
  return key;
}
