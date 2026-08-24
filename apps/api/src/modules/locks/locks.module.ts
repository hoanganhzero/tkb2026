import { Body, Controller, Delete, Get, Inject, Module, Param, Post } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { requestContext } from '../../common/request-context.js';
import { ApiError, notFound } from '../../common/api-error.js';
import {
  evaluateAcquire, HEARTBEAT_MS, LOCK_TTL_MS,
  type LockRow
} from './locks.logic.ts';

/**
 * REST khoá mềm — tkb_api_spec.md §6.3–6.5.
 * evaluateAcquire() (locks.logic.ts) là phần thuần đã test; service chỉ map
 * hàng CSDL <-> LockRow và thực thi kết quả bằng UNIQUE(timetable_id,class_id).
 */
@Controller('schools/:sid/timetables/:tid/locks')
export class LocksController {
  constructor(@Inject(DbService) private db: DbService) {}

  private async loadExisting(sql: any, tid: string): Promise<LockRow[]> {
    const rows = await sql`
      SELECT l.class_id, l.user_id, u.full_name AS user_name,
             extract(epoch from l.expires_at) * 1000 AS expires_at,
             extract(epoch from COALESCE(l.acquired_at, l.expires_at - interval '60 seconds')) * 1000 AS last_write_at
      FROM timetable_locks l
      LEFT JOIN users u ON u.id = l.user_id
      WHERE l.timetable_id = ${tid} AND l.class_id IS NOT NULL`;
    return rows.map((r: any) => ({
      classId: r.class_id, userId: r.user_id, userName: r.user_name ?? '?',
      expiresAt: Number(r.expires_at), lastWriteAt: Number(r.last_write_at)
    }));
  }

  @Get()
  list(@Param('tid') tid: string) {
    return this.db.tx(async (sql) => this.loadExisting(sql, tid));
  }

  /** Xin khoá — cấp từng phần; takeover=true theo điều kiện §6.5 */
  @Post()
  acquire(
    @Param('tid') tid: string,
    @Body() body: { classIds: string[]; takeover?: boolean },
  ) {
    const ctx = requestContext.getStore();
    if (!ctx?.userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập.');
    const userId = ctx.userId;
    const role = ctx.role as any;

    return this.db.tx(async (sql) => {
      const [tt] = await sql`SELECT status FROM timetables WHERE id = ${tid}`;
      if (!tt) throw notFound('thời khoá biểu');
      if (tt.status === 'published') {
        throw new ApiError(409, 'TIMETABLE_LOCKED', 'Thời khoá biểu đã công bố.');
      }

      // Khoá toàn bảng của solver chặn mọi yêu cầu mới (§6.6)
      const full = await sql`
        SELECT u.full_name AS user_name FROM timetable_locks l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.timetable_id = ${tid} AND l.class_id IS NULL AND l.expires_at > now()`;
      if (full.length && body.takeover !== true) {
        throw new ApiError(409, 'TIMETABLE_LOCKED',
          `Đang chạy xếp tự động bởi ${full[0].user_name ?? 'người khác'}.`,
          { lockedBy: full[0].user_name ?? null });
      }

      const existing = await this.loadExisting(sql, tid);
      const result = evaluateAcquire(existing, body.classIds, { userId, role }, body.takeover === true);

      for (const classId of result.granted) {
        await sql`
          INSERT INTO timetable_locks (timetable_id, class_id, user_id, expires_at)
          VALUES (${tid}, ${classId}, ${userId}, now() + (${LOCK_TTL_MS} || ' milliseconds')::interval)
          ON CONFLICT (timetable_id, class_id)
          DO UPDATE SET user_id = EXCLUDED.user_id,
                        acquired_at = now(),
                        expires_at = EXCLUDED.expires_at`;
      }
      return result;
    });
  }

  /** Gia hạn mỗi 20s — chỉ gia hạn khoá VẪN CÒN HẠN của chính mình (§6.3) */
  @Post('heartbeat')
  heartbeat(@Param('tid') tid: string, @Body() body: { classIds: string[] }) {
    const ctx = requestContext.getStore();
    if (!ctx?.userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập.');
    const userId = ctx.userId;
    return this.db.tx(async (sql) => {
      const rows = await sql`
        UPDATE timetable_locks SET expires_at = now() + (${HEARTBEAT_MS} || ' milliseconds')::interval
        WHERE timetable_id = ${tid} AND user_id = ${userId}
          AND class_id = ANY(${body.classIds}::uuid[])
          AND expires_at > now()
        RETURNING class_id`;
      return { renewed: rows.map((r: any) => r.class_id) };
    });
  }

  @Delete()
  release(@Param('tid') tid: string, @Body() body: { classIds?: string[] }) {
    const ctx = requestContext.getStore();
    if (!ctx?.userId) throw new ApiError(401, 'UNAUTHENTICATED', 'Chưa đăng nhập.');
    const userId = ctx.userId;
    return this.db.tx(async (sql) => {
      if (body.classIds?.length) {
        await sql`DELETE FROM timetable_locks
                  WHERE timetable_id = ${tid} AND user_id = ${userId}
                    AND class_id = ANY(${body.classIds}::uuid[])`;
      } else {
        await sql`DELETE FROM timetable_locks WHERE timetable_id = ${tid} AND user_id = ${userId}`;
      }
      return { ok: true };
    });
  }
}

@Module({
  controllers: [LocksController],
  providers: []
})
export class LocksModule {}
