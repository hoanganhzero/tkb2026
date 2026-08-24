import { Body, Controller, Get, Inject, Injectable, Module, Param, Post } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { ApiError, notFound } from '../../common/api-error.js';
import { requestContext } from '../../common/request-context.middleware.js';
import {
  buildSnapshotPayload, validateSnapshotPayload,
  type SnapshotPayload, type SnapshotLessonRow, type SnapshotChildPair
} from './snapshots.logic.ts';

@Injectable()
export class SnapshotsService {
  constructor(@Inject(DbService) private db: DbService) {}

  list(timetableId: string) {
    return this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT id, label, soft_score AS "softScore", created_at AS "createdAt",
               created_by AS "createdBy"
        FROM timetable_snapshots WHERE timetable_id = ${timetableId}
        ORDER BY created_at DESC`;
      return { data: rows };
    });
  }

  /** Chụp trạng thái hiện tại — lessons + children giữ nguyên id */
  create(timetableId: string, label: string | null, userId?: string) {
    return this.db.tx(async (sql) => {
      const [tt] = await sql`SELECT id FROM timetables WHERE id = ${timetableId}`;
      if (!tt) throw notFound('thời khoá biểu');

      const lessons = (await sql`
        SELECT id, assignment_id, subject_id, day_of_week, period_id,
               room_id, is_pinned, double_group_id
        FROM lessons WHERE timetable_id = ${timetableId}`) as unknown as SnapshotLessonRow[];
      const classes = (await sql`
        SELECT lc.lesson_id, lc.class_id AS other_id
        FROM lesson_classes lc JOIN lessons l ON l.id = lc.lesson_id
        WHERE l.timetable_id = ${timetableId}`) as unknown as SnapshotChildPair[];
      const teachers = (await sql`
        SELECT lt.lesson_id, lt.teacher_id AS other_id
        FROM lesson_teachers lt JOIN lessons l ON l.id = lt.lesson_id
        WHERE l.timetable_id = ${timetableId}`) as unknown as SnapshotChildPair[];

      const payload = buildSnapshotPayload(lessons, classes, teachers);
      const [snap] = await sql`
        INSERT INTO timetable_snapshots (timetable_id, label, payload, soft_score, created_by)
        VALUES (${timetableId}, ${label}, ${JSON.stringify(payload)}::jsonb,
                (SELECT soft_score FROM timetables WHERE id = ${timetableId}),
                ${userId ?? null})
        RETURNING id, created_at`;
      return snap;
    });
  }

  /**
   * Khôi phục: xoá toàn bộ lessons hiện tại (kể cả ghim — snapshot là nguồn sự thật)
   * rồi chèn lại từ payload GIỮ NGUYÊN id. Unique index là chốt hạ nếu payload hỏng.
   */
  restore(timetableId: string, snapshotId: string) {
    return this.db.tx(async (sql) => {
      const [row] = await sql`
        SELECT payload FROM timetable_snapshots
        WHERE id = ${snapshotId} AND timetable_id = ${timetableId}`;
      if (!row) throw notFound('snapshot');

      let parsed: unknown;
      try { parsed = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload; }
      catch { throw new ApiError(422, 'BAD_SNAPSHOT', 'Payload snapshot không đọc được.'); }
      const v = validateSnapshotPayload(parsed);
      if (!v.ok) throw new ApiError(422, 'BAD_SNAPSHOT', v.message);
      const payload = v.payload as SnapshotPayload;

      await sql`DELETE FROM lessons WHERE timetable_id = ${timetableId}`;
      if (payload.lessons.length) {
        await sql`
          INSERT INTO lessons (id, school_id, timetable_id, assignment_id, subject_id,
                               day_of_week, period_id, room_id, is_pinned, double_group_id)
          SELECT l.id, current_school_id(), ${timetableId}, l.assignment_id, l.subject_id,
                 l.day_of_week, l.period_id, l.room_id, l.is_pinned, l.double_group_id
          FROM unnest(${payload.lessons.map((l) => l.id)}::uuid[],
                      ${payload.lessons.map((l) => l.assignment_id)}::uuid[],
                      ${payload.lessons.map((l) => l.subject_id)}::uuid[],
                      ${payload.lessons.map((l) => l.day_of_week)}::int[],
                      ${payload.lessons.map((l) => l.period_id)}::uuid[],
                      ${payload.lessons.map((l) => l.room_id)}::uuid[],
                      ${payload.lessons.map((l) => l.is_pinned)}::boolean[],
                      ${payload.lessons.map((l) => l.double_group_id)}::uuid[])
            AS l(id, assignment_id, subject_id, day_of_week, period_id, room_id, is_pinned, double_group_id)`;
      }
      for (const c of payload.classes) {
        await sql`INSERT INTO lesson_classes (lesson_id, class_id) VALUES (${c.lesson_id}, ${c.other_id})`;
      }
      for (const t of payload.teachers) {
        await sql`INSERT INTO lesson_teachers (lesson_id, teacher_id) VALUES (${t.lesson_id}, ${t.other_id})`;
      }

      // Trigger bump version đã chạy; trả version mới cho client refresh ETag
      const [tt] = await sql`SELECT version FROM timetables WHERE id = ${timetableId}`;
      return { ok: true, restoredLessons: payload.lessons.length, version: tt.version };
    });
  }
}

@Controller('schools/:sid/timetables/:tid/snapshots')
export class SnapshotsController {
  constructor(@Inject(SnapshotsService) private svc: SnapshotsService) {}

  @Get()
  list(@Param('tid') tid: string) { return this.svc.list(tid); }

  @Post()
  create(
    @Param('tid') tid: string,
    @Body() body: { label?: string },
  ) {
    const ctx = requestContext.getStore();
    return this.svc.create(tid, body?.label ?? null, ctx?.userId);
  }

  @Post(':snid/restore')
  restore(@Param('tid') tid: string, @Param('snid') snid: string) {
    return this.svc.restore(tid, snid);
  }
}

@Module({
  controllers: [SnapshotsController],
  providers: [SnapshotsService]
})
export class SnapshotsModule {}
