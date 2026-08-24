import { Controller, Get, Inject, Injectable, Module, Param, Post } from '@nestjs/common';
import crypto from 'node:crypto';
import { DbService } from '../../db/db.service.js';
import { ApiError, notFound } from '../../common/api-error.js';
import { requestContext } from '../../common/request-context.js';
import {
  publishBlocker, unpublishBlocker, makePublicSlug
} from './publish.logic.ts';
import type { PublishableState } from './publish.logic.ts';

@Injectable()
export class PublishService {
  constructor(@Inject(DbService) private db: DbService) {}

  /** Trạng thái + blocker cho UI hiện nút Công bố khi khả dụng */
  state(timetableId: string) {
    return this.db.tx(async (sql) => {
      const [tt] = await sql`
        SELECT id, status, hard_violations AS "hardViolations"
        FROM timetables WHERE id = ${timetableId}`;
      if (!tt) throw notFound('thời khoá biểu');
      return { ...tt, blocker: publishBlocker(tt as PublishableState) };
    });
  }

  /** POST publish — owner/admin (PermissionGuard). Sinh trang công khai lần đầu. */
  async publish(timetableId: string) {
    const ctx = requestContext.getStore();
    return this.db.tx(async (sql) => {
      const [tt] = await sql`
        SELECT t.id, t.status, t.hard_violations AS "hardViolations",
               t.school_id AS school_id,
               s.slug AS school_slug, y.name AS year_name,
               sem.ordinal AS semester_ordinal
        FROM timetables t
        JOIN school_years y ON y.id = t.school_year_id
        JOIN schools s ON s.id = t.school_id
        LEFT JOIN semesters sem ON sem.id = t.semester_id
        WHERE t.id = ${timetableId}`;
      if (!tt) throw notFound('thời khoá biểu');

      const blocker = publishBlocker(tt as PublishableState);
      if (blocker) throw new ApiError(409, 'PUBLISH_BLOCKED', blocker, { status: tt.status });

      await sql`UPDATE timetables SET status = 'published' WHERE id = ${timetableId}`;

      // Trang công khai: tạo một lần, các lần công bố sau tái sử dụng
      const existing = await sql`
        SELECT public_slug FROM publications
        WHERE timetable_id = ${timetableId} AND is_public = true LIMIT 1`;
      let slug = existing[0]?.public_slug;
      if (!slug) {
        slug = makePublicSlug(
          tt.school_slug, tt.year_name, tt.semester_ordinal,
          crypto.randomBytes(2).toString('hex')
        );
        await sql`
          INSERT INTO publications (school_id, timetable_id, public_slug, published_by)
          VALUES (${tt.school_id}, ${timetableId}, ${slug}, ${ctx?.userId ?? null})`;
      }

      return { ok: true, status: 'published', publicSlug: slug };
    });
  }

  /** POST unpublish — gỡ khỏi trang công khai, bản về 'ready' */
  async unpublish(timetableId: string) {
    return this.db.tx(async (sql) => {
      const [tt] = await sql`
        SELECT status FROM timetables WHERE id = ${timetableId}`;
      if (!tt) throw notFound('thời khoá biểu');
      const blocker = unpublishBlocker(String(tt.status));
      if (blocker) throw new ApiError(409, 'UNPUBLISH_BLOCKED', blocker);

      await sql`UPDATE timetables SET status = 'ready' WHERE id = ${timetableId}`;
      await sql`UPDATE publications SET is_public = false WHERE timetable_id = ${timetableId}`;
      return { ok: true, status: 'ready' };
    });
  }
}

@Controller('schools/:sid/timetables/:tid')
export class PublishController {
  constructor(@Inject(PublishService) private svc: PublishService) {}

  @Get('publish-state')
  state(@Param('tid') tid: string) { return this.svc.state(tid); }

  @Post('publish')
  publish(@Param('tid') tid: string) { return this.svc.publish(tid); }

  @Post('unpublish')
  unpublish(@Param('tid') tid: string) { return this.svc.unpublish(tid); }
}

@Module({
  controllers: [PublishController],
  providers: [PublishService]
})
export class PublishModule {}
