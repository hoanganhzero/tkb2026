import { Injectable } from '@nestjs/common';
import crypto from 'node:crypto';
import { Inject } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { hashPassword, verifyPassword } from '../../common/password.util.js';
import { signJwt } from '../../common/jwt.util.js';
import { ApiError } from '../../common/api-error.js';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

function slugify(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'truong';
}

async function issueTokens(db: Pick<DbService, 'sql'>, userId: string): Promise<TokenPair> {
  const accessToken = signJwt({ sub: userId }, 15 * 60);
  const refreshToken = crypto.randomBytes(48).toString('hex');
  await db.sql`INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
               VALUES (${userId}, ${crypto.createHash('sha256').update(refreshToken).digest('hex')},
                       now() + interval '30 days')`;
  return { accessToken, refreshToken, expiresIn: 900 };
}

@Injectable()
export class AuthService {
  constructor(@Inject(DbService) private db: DbService) {}

  async register(input: {
    fullName: string; email: string; phone?: string;
    password: string; schoolName: string; level?: string;
  }) {
    const exists = await this.db.sql`SELECT id FROM users WHERE email = ${input.email}`;
    if (exists.length) {
      throw new ApiError(409, 'EMAIL_TAKEN', 'Email này đã được dùng cho một tài khoản khác.');
    }
    const slug = `${slugify(input.schoolName)}-${crypto.randomBytes(2).toString('hex')}`;

    return this.db.sql.begin(async (sql) => {
      const [user] = await sql`
        INSERT INTO users (email, phone, password_hash, full_name)
        VALUES (${input.email}, ${input.phone ?? null}, ${hashPassword(input.password)}, ${input.fullName})
        RETURNING id, email, full_name`;

      const [school] = await sql`
        INSERT INTO schools (slug, name, level)
        VALUES (${slug}, ${input.schoolName}, ${input.level ?? 'secondary'})
        RETURNING id, slug, name`;

      await sql`
        INSERT INTO school_members (school_id, user_id, role)
        VALUES (${school.id}, ${user.id}, 'owner')`;

      // Gói miễn phí mặc định, dùng thử 30 ngày đầy đủ tính năng
      await sql`
        INSERT INTO subscriptions (school_id, plan_id, status, trial_ends_at)
        SELECT ${school.id}, p.id, now() + interval '30 days'
        FROM plans p WHERE p.code = 'free'`;

      const tokens = await issueTokens(this.db, String(user.id));
      return { user, school, ...tokens };
    });
  }

  async login(identifier: string, password: string) {
    const rows = await this.db.sql`
      SELECT id, password_hash, full_name, status
      FROM users WHERE email = ${identifier} OR phone = ${identifier}`;
    if (!rows.length) throw new ApiError(401, 'BAD_CREDENTIALS', 'Sai thông tin đăng nhập hoặc mật khẩu.');

    const user = rows[0];
    if (user.status === 'disabled') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', 'Tài khoản đã bị khoá. Liên hệ quản trị viên trường.');
    }
    if (!verifyPassword(password, user.password_hash)) {
      throw new ApiError(401, 'BAD_CREDENTIALS', 'Sai thông tin đăng nhập hoặc mật khẩu.');
    }
    await this.db.sql`UPDATE users SET last_login_at = now() WHERE id = ${user.id}`;

    const tokens = await issueTokens(this.db, String(user.id));
    const memberships = await this.db.sql`
      SELECT s.id AS school_id, s.slug, s.name, m.role
      FROM school_members m JOIN schools s ON s.id = m.school_id
      WHERE m.user_id = ${user.id} AND m.status = 'active'`;
    return { user: { id: user.id, fullName: user.full_name }, memberships, ...tokens };
  }

  async me(userId: string) {
    const [user] = await this.db.sql`
      SELECT id, email, phone, full_name, avatar_url FROM users WHERE id = ${userId}`;
    if (!user) throw new ApiError(404, 'USER_NOT_FOUND', 'Không tìm thấy tài khoản.');
    const memberships = await this.db.sql`
      SELECT s.id AS school_id, s.slug, s.name, m.role
      FROM school_members m JOIN schools s ON s.id = m.school_id
      WHERE m.user_id = ${userId} AND m.status = 'active'`;
    return { user, memberships };
  }
}
