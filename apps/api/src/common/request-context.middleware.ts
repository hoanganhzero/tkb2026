import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { verifyJwt } from './jwt.util.js';
import { ApiError } from './api-error.js';
import { DbService } from '../db/db.service.js';
import { requestContext, type RequestContextData } from './request-context.js';

const PUBLIC_ROUTES = [
  '/v1/healthz',
  '/v1/auth/login',
  '/v1/auth/register',
  '/v1/auth/refresh',
  '/v1/auth/password'
];

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(@Inject(DbService) private db: DbService) {}

  async use(req: Request & { requestId?: string }, _res: Response, next: NextFunction) {
    const path = req.originalUrl ?? req.url ?? '';
    if (PUBLIC_ROUTES.some((p) => path.startsWith(p))) return next();

    const ctx: RequestContextData = {
      connectionId: (req.headers['x-connection-id'] as string) ?? undefined
    };

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập hoặc thiếu token.');
    }
    try {
      ctx.userId = String(verifyJwt(auth.slice(7)).sub);
    } catch {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }

    // Ngữ cảnh trường: header X-School-Id ưu tiên, sau đó trích từ đường dẫn
    let schoolId = req.headers['x-school-id'] as string | undefined;
    if (!schoolId) {
      const m = path.match(/\/schools\/([0-9a-fA-F-]{36})/);
      if (m) schoolId = m[1];
    }
    if (schoolId) {
      // Tra vai trò trong transaction có current_user_id — policy self-read
      // của school_members (schema mục 12c) cho phép đọc dòng của chính mình.
      const rows = await this.db.sql.begin(async (sql) => {
        await sql`SELECT set_config('app.current_user_id', ${ctx.userId!}, true)`;
        return sql`SELECT role FROM school_members
                   WHERE user_id = ${ctx.userId!} AND school_id = ${schoolId!}
                     AND status = 'active'`;
      });
      if (!rows.length) {
        throw new ApiError(403, 'NOT_A_MEMBER', 'Bạn không phải thành viên đang hoạt động của trường này.');
      }
      ctx.schoolId = schoolId;
      ctx.role = rows[0].role as string;
    }

    requestContext.run(ctx, next);
  }
}
