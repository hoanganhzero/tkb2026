import crypto from 'node:crypto';

/**
 * Khung đầu tiên dùng scrypt (có sẵn trong node:crypto) để không kéo phụ thuộc
 * native. TRƯỚC KHI PHÁT HÀNH: chuyển sang argon2id theo tkb_api_spec.md §1.2.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}
