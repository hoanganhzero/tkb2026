import crypto from 'node:crypto';

/**
 * JWT HS256 viết thủ công bằng node:crypto — đủ dùng, không phụ thuộc thêm.
 * Access token sống 15 phút (tkb_api_spec.md §1.2).
 */

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Thiếu JWT_SECRET');
  return s;
}

export interface JwtPayload {
  sub: string;              // user id
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

export function signJwt(payload: JwtPayload, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const head = Buffer.from(JSON.stringify(header)).toString('base64url');
  const data = head + '.' + Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(data).digest('base64url');
  return data + '.' + sig;
}

export function verifyJwt(token: string): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Sai khuôn dạng token');
  const expected = crypto.createHmac('sha256', secret())
    .update(parts[0] + '.' + parts[1])
    .digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('Chữ ký không hợp lệ');
  }
  const body = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as JwtPayload;
  if ((body.exp ?? 0) * 1000 < Date.now()) throw new Error('Token đã hết hạn');
  return body;
}
