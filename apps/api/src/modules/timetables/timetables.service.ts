import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { ApiError, notFound, staleVersion } from '../../common/api-error.js';
import { requestContext } from '../../common/request-context.js';
import { fromGridPayload, buildTimetableSchoolXlsx } from '../export/xlsx.ts';
import type { GridPayload } from '../../lib/grid-payload.js';
import { scanConflicts, type ConflictOut } from './conflicts.ts';

/** Bảng màu môn học chuẩn — khớp tkb_design_spec.md §3.2 */
const PALETTE = [
  '#DCEAFB', '#FBE0E0', '#DDF2DF', '#FCE8D5', '#E8E0F7', '#D6F0EF',
  '#F8F0CE', '#DFE6EC', '#F7DCD2', '#DDE1F5', '#E6EED7', '#EDE3D8'
];

@Injectable()
export class TimetablesService {
  constructor(@Inject(DbService) private db: DbService) {}

  /** school_year_id của một timetable — helper nội bộ */
  private async yidOf(sql: any, timetableId: string): Promise<string> {
    const [r] = await sql`SELECT school_year_id AS yid FROM timetables WHERE id = ${timetableId}`;
    return r?.yid;
  }

  /**
   * GET /schools/:sid/timetables/:tid/grid — khuôn dạng từ điển + mảng theo
   * cột (tkb_api_spec.md §3.2): ~75KB thay vì ~403KB cho trường 45 lớp.
   */
  async grid(tid: string, ifNoneMatch?: string):
    Promise<{ notModified?: true; etag: string; payload?: GridPayload }> {

    const tt = await this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT id, name, status, version, soft_score AS "softScore",
               hard_violations AS "hardViolations",
               extract(epoch from updated_at)::bigint AS upd,
               active_days AS "activeDays"
        FROM timetables t JOIN school_years y ON y.id = t.school_year_id
        WHERE t.id = ${tid}`;
      if (!rows.length) throw notFound('thời khoá biểu');
      return rows[0];
    });

    const etag = `"v${tt.version}-${tt.upd}"`;
    if (ifNoneMatch === etag) return { notModified: true, etag };

    const payload = await this.db.tx(async (sql) =>
      this.buildPayload(sql as any, tid, tt));
    return { etag, payload };
  }

  private async buildPayload(sql: any, tid: string, tt: any): Promise<GridPayload> {
    const periods = await sql`
      SELECT p.id, p.session, p.ordinal, p.name,
             p.start_time::text AS start, p.end_time::text AS end, p.day_position
      FROM periods p
      JOIN timetables t ON t.school_year_id = p.school_year_id
      WHERE t.id = ${tid} ORDER BY p.day_position`;
    const periodIndex = new Map<string, number>();
    periods.forEach((p: any, i: number) => periodIndex.set(p.id, i));

    const classes = await sql`
      SELECT c.id, c.name, c.grade_id AS "gradeId", c.home_room_id AS "roomId"
      FROM classes c JOIN timetables t ON t.school_year_id = c.school_year_id
      WHERE t.id = ${tid} ORDER BY c.sort_order, c.name`;
    const classIndex = new Map<string, number>();
    classes.forEach((c: any, i: number) => classIndex.set(c.id, i));

    const teachers = await sql`
      SELECT DISTINCT t.id, t.full_name AS name, t.short_name AS short
      FROM lesson_teachers lt
      JOIN lessons l ON l.id = lt.lesson_id AND l.timetable_id = ${tid}
      JOIN teachers t ON t.id = lt.teacher_id ORDER BY t.full_name`;
    const teacherIndex = new Map<string, number>();
    teachers.forEach((t: any, i: number) => teacherIndex.set(t.id, i));

    const subjects = await sql`
      SELECT DISTINCT s.id, s.short_name AS short, s.name, s.color
      FROM lessons l JOIN subjects s ON s.id = l.subject_id
      WHERE l.timetable_id = ${tid} ORDER BY s.sort_order`;
    const subjectIndex = new Map<string, number>();
    subjects.forEach((s: any, i: number) => subjectIndex.set(s.id, i));

    const rooms = await sql`
      SELECT r.id, r.code FROM rooms r
      JOIN timetables t ON t.school_year_id = r.school_year_id
      WHERE t.id = ${tid} ORDER BY r.code`;
    const roomIndex = new Map<string, number>();
    rooms.forEach((r: any, i: number) => roomIndex.set(r.id, i));
    const NO_ROOM = -1;

    const rows = await sql`
      SELECT l.id, l.day_of_week, l.period_id, l.is_pinned, l.double_group_id,
             l.subject_id, l.room_id,
             lc.class_id, lc.section_id,
             cs.name AS section_name,
             (SELECT t2.teacher_id FROM lesson_teachers t2 WHERE t2.lesson_id = l.id LIMIT 1) AS teacher_id
      FROM lessons l
      JOIN lesson_classes lc ON lc.lesson_id = l.id
      LEFT JOIN class_sections cs ON cs.id = lc.section_id
      WHERE l.timetable_id = ${tid}
      ORDER BY l.id`;

    const P = periods.length;                 // số tiết trong khung MỘT ngày
    const activeDays: number[] = tt.activeDays ?? [1, 2, 3, 4, 5, 6];
    // slot = dayIndex * P + posInDay ; dayIndex = vị trí của day_of_week trong
    // active_days ; posInDay = thứ tự tiết theo day_position (0..P-1)
    const slotOf = (dayOfWeek: number, periodId: string): number => {
      const di = activeDays.indexOf(dayOfWeek);
      const pi = periodIndex.get(periodId) ?? 0;
      return (di < 0 ? 0 : di) * P + (pi % P);
    };

    const L = rows.length;
    const out: GridPayload['lessons'] = {
      count: L,
      id: new Array(L), slot: new Array(L), subject: new Array(L),
      class: new Array(L), teacher: new Array(L), room: new Array(L), flags: new Array(L)
    };

    const pairGroups = new Map<string, { idx: number; pos: number }[]>();

    rows.forEach((r: any, i: number) => {
      out.id[i] = r.id;
      out.slot[i] = slotOf(r.day_of_week, r.period_id);
      out.subject[i] = subjectIndex.get(r.subject_id) ?? 0;
      out.class[i] = classIndex.get(r.class_id) ?? 0;
      out.teacher[i] = r.teacher_id ? teacherIndex.get(r.teacher_id) ?? -1 : -1;
      out.room[i] = r.room_id ? roomIndex.get(r.room_id) ?? NO_ROOM : NO_ROOM;
      let flags = r.is_pinned ? 1 : 0;
      if (r.double_group_id) {
        const arr = pairGroups.get(r.double_group_id) ?? [];
        arr.push({ idx: i, pos: periodIndex.get(r.period_id) ?? 0 });
        pairGroups.set(r.double_group_id, arr);
      }
      out.flags[i] = flags;
    });

    for (const [, members] of pairGroups) {
      members.sort((a, b) => a.pos - b.pos);
      members.forEach((m, k) => { out.flags[m.idx] |= k === 0 ? 4 : 8; });
    }

    const palette = [...PALETTE];
    const subjectDict = subjects.map((s: any) => {
      let ci = palette.indexOf(s.color);
      if (ci < 0 && s.color) { palette.push(s.color); ci = palette.length - 1; }
      return { id: s.id, short: s.short, name: s.name, color: ci };
    });

    return {
      timetable: {
        id: tt.id, name: tt.name, status: tt.status, version: tt.version,
        softScore: tt.softScore, hardViolations: tt.hardViolations
      },
      dict: {
        days: activeDays,
        periods,
        classes,
        teachers,
        subjects: subjectDict,
        rooms,
        palette
      },
      lessons: out
    };
  }

  /**
   * PATCH /lessons/:lid/move — v1 kiểm chứng phần CỨNG ở server (occupancy +
   * availability), phần MỀM sẽ trả bằng cost-core qua cache trạng thái của
   * worker (solver spec §12.4). Unique index ở DB là chốt hạ cuối cùng:
   * nếu có lỗi logic, transaction thất bại thay vì ghi lịch sai.
   */
  async move(lid: string, body: {
    toSlot: { dayOfWeek: number; periodId: string };
    expectedVersion?: number;
    dryRun?: boolean;
  }) {
    const ctx = requestContext.getStore();
    void ctx;    return this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT l.id, l.timetable_id, l.day_of_week, l.period_id,
               t.version, t.status
        FROM lessons l
        JOIN timetables t ON t.id = l.timetable_id
        WHERE l.id = ${lid}
          AND EXISTS (SELECT 1 FROM periods p
                      WHERE p.id = ${body.toSlot.periodId}
                        AND p.school_year_id = t.school_year_id)`;
      if (!rows.length) throw notFound('tiết học');
      const cur = rows[0];

      if (cur.status === 'published') {
        throw new ApiError(409, 'TIMETABLE_LOCKED', 'Thời khoá biểu đã công bố, không thể chỉnh sửa.');
      }
      if (body.expectedVersion !== undefined && body.expectedVersion !== cur.version) {
        throw staleVersion(cur.version);
      }

      // Ràng buộc cứng phía ứng dụng: GV/lớp có bận ô đích không?
      const clashes = await sql`
        SELECT 'teacher' AS kind, t.full_name AS name
        FROM lesson_teachers lt
        JOIN lessons other ON other.id = lt.lesson_id AND other.id <> ${lid}
        JOIN teachers t ON t.id = lt.teacher_id
        WHERE lt.teacher_id IN (SELECT teacher_id FROM lesson_teachers WHERE lesson_id = ${lid})
          AND other.timetable_id = ${cur.timetable_id}
          AND other.day_of_week = ${body.toSlot.dayOfWeek}
          AND other.period_id = ${body.toSlot.periodId}
        UNION ALL
        SELECT 'class', c.name
        FROM lesson_classes lc
        JOIN lessons other ON other.id = lc.lesson_id AND other.id <> ${lid}
        JOIN classes c ON c.id = lc.class_id
        WHERE lc.class_id IN (SELECT class_id FROM lesson_classes WHERE lesson_id = ${lid})
          AND other.timetable_id = ${cur.timetable_id}
          AND other.day_of_week = ${body.toSlot.dayOfWeek}
          AND other.period_id = ${body.toSlot.periodId}`;
      if (clashes.length) {
        throw new ApiError(409, 'LESSON_MOVE_BLOCKED',
          `Không đặt được vào ô này: ${clashes[0].kind === 'teacher' ? 'giáo viên' : 'lớp'} "${clashes[0].name}" đang bận.`,
          { conflicts: clashes });
      }

      if (!body.dryRun) {
        await sql`
          UPDATE lessons SET day_of_week = ${body.toSlot.dayOfWeek}, period_id = ${body.toSlot.periodId}
          WHERE id = ${lid}`;
        // Trigger trg_sync_lesson_slot đồng bộ bảng con;
        // trigger trg_bump_ver_* tăng version — ETag tự đổi.
      }

      const [tt] = await sql`
        SELECT version FROM timetables WHERE id = ${cur.timetable_id}`;
      return {
        lesson: { id: lid, ...body.toSlot },
        timetable: { version: tt.version },
        delta: null // TODO: nối cost-core qua cache trạng thái worker
      };
    });
  }

  /** GET .../export.xlsx — timetable_school theo export design §3.2 */
  async exportXlsx(timetableId: string): Promise<{ buffer: Buffer; filename: string }> {
    const { payload } = await this.grid(timetableId);
    if (!payload) throw new ApiError(500, 'INTERNAL', 'Grid cache miss.');

    const school = await this.db.tx(async (sql) => {
      const [s] = await sql`
        SELECT s.name FROM schools s
        JOIN timetables t ON t.school_id = s.id WHERE t.id = ${timetableId}`;
      return s?.name ?? 'Trường học';
    });

    const input = fromGridPayload(payload, { school });
    const buffer = await buildTimetableSchoolXlsx(input);
    const strip = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '-');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return { buffer, filename: `TKB_ToanTruong_${strip(payload.timetable.name)}_${stamp}.xlsx` };
  }

  /** POST /timetables — tạo bản nháp mới */
  async create(name: string, semesterId: string | null) {
    const ctx = requestContext.getStore();
    return this.db.tx(async (sql) => {
      const [row] = await sql`
        INSERT INTO timetables (school_id, school_year_id, semester_id, name, status)
        VALUES (current_school_id(),
                ${ctx?.schoolId ? (await this.activeYear(sql, ctx.schoolId)).id : null},
                ${semesterId}, ${name}, 'draft')
        RETURNING *`;
      return row;
    });
  }

  private async activeYear(sql: any, schoolId: string): Promise<{ id: string }> {
    const [y] = await sql`
      SELECT id FROM school_years WHERE school_id = ${schoolId} AND is_active = true`;
    if (!y) throw new ApiError(422, 'NO_ACTIVE_YEAR', 'Chưa kích hoạt năm học nào.');
    return y;
  }

  /**
   * POST /lessons/place — đặt tiết MỚI từ phân công vào ô trống.
   * Kiểm tra occupancy + lịch bận khai báo; unique index là chốt hạ.
   */
  async placeLesson(timetableId: string, dto: {
    assignmentId: string; dayOfWeek: number; periodId: string;
  }) {
    const ctx = requestContext.getStore();
    void ctx;
    return this.db.tx(async (sql) => {
      const [tt] = await sql`
        SELECT id, status, version FROM timetables WHERE id = ${timetableId}`;
      if (!tt) throw notFound('thời khoá biểu');
      if (tt.status === 'published') {
        throw new ApiError(409, 'TIMETABLE_LOCKED', 'Đã công bố — không thể chỉnh sửa.');
      }

      const yid = await this.yidOf(sql, timetableId);

      const [asg] = await sql`
        SELECT a.id, a.subject_id,
               (SELECT json_agg(class_id)::jsonb FROM assignment_classes WHERE assignment_id = a.id) AS class_ids,
               (SELECT json_agg(teacher_id)::jsonb FROM assignment_teachers WHERE assignment_id = a.id) AS teacher_ids
        FROM assignments a
        WHERE a.id = ${dto.assignmentId} AND a.school_year_id = ${yid}`;
      if (!asg) throw notFound('phân công');

      // Xung đột cứng: lớp/GV đã có tiết ở ô đích?
      const clash = await sql`
        SELECT 'teacher' AS kind, u.name FROM (
          SELECT jt.teacher_id AS id FROM lesson_teachers jt
          JOIN lessons jl ON jl.id = jt.lesson_id
          JOIN assignment_teachers at2
            ON at2.assignment_id = ${dto.assignmentId}
           AND at2.teacher_id = jt.teacher_id
          WHERE jl.timetable_id = ${timetableId}
            AND jl.day_of_week = ${dto.dayOfWeek} AND jl.period_id = ${dto.periodId}
        ) q JOIN teachers u ON u.id = q.id
        UNION ALL
        SELECT 'class', u.name FROM (
          SELECT jc.class_id AS id FROM lesson_classes jc
          JOIN lessons jl ON jl.id = jc.lesson_id
          JOIN assignment_classes ac2
            ON ac2.assignment_id = ${dto.assignmentId}
           AND ac2.class_id = jc.class_id
          WHERE jl.timetable_id = ${timetableId}
            AND jl.day_of_week = ${dto.dayOfWeek} AND jl.period_id = ${dto.periodId}
        ) q JOIN classes u ON u.id = q.id`;
      if (clash.length) {
        throw new ApiError(409, 'LESSON_MOVE_BLOCKED',
          `Không đặt được: ${clash[0].kind === 'teacher' ? 'giáo viên' : 'lớp'} "${clash[0].name}" đang bận ô này.`,
          { conflicts: clash });
      }

      // Lịch bận khai báo (availability busy) trên trục GV hoặc lớp
      const busy = await sql`
        SELECT 1 FROM availability_slots av
        WHERE av.school_year_id = ${yid}
          AND av.preference = 'busy'
          AND av.day_of_week = ${dto.dayOfWeek} AND av.period_id = ${dto.periodId}
          AND ((av.owner_type = 'teacher' AND av.owner_id::text = ANY(
                 SELECT t::text FROM jsonb_array_elements_text(${asg.teacher_ids ?? '[]'}::jsonb) t))
            OR (av.owner_type = 'class' AND av.owner_id::text = ANY(
                 SELECT c::text FROM jsonb_array_elements_text(${asg.class_ids ?? '[]'}::jsonb) c)))
        LIMIT 1`;
      if (busy.length) {
        throw new ApiError(409, 'SLOT_NOT_ALLOWED',
          'Ô này nằm trong lịch bận đã khai báo của giáo viên/lớp.',
          { toSlot: dto });
      }

      const [lesson] = await sql`
        INSERT INTO lessons (school_id, timetable_id, assignment_id, subject_id,
                             day_of_week, period_id)
        SELECT current_school_id(), ${timetableId}, a.id, a.subject_id,
               ${dto.dayOfWeek}, ${dto.periodId}
        FROM assignments a WHERE a.id = ${dto.assignmentId}
        RETURNING id, day_of_week AS "dayOfWeek", period_id AS "periodId"`;

      for (const cid of asg.class_ids ?? []) {
        await sql`INSERT INTO lesson_classes (lesson_id, class_id)
                  VALUES (${lesson.id}, ${cid})`;
      }
      for (const tid of asg.teacher_ids ?? []) {
        await sql`INSERT INTO lesson_teachers (lesson_id, teacher_id)
                  VALUES (${lesson.id}, ${tid})`;
      }

      const [v] = await sql`SELECT version FROM timetables WHERE id = ${timetableId}`;
      return { lesson, timetable: { version: v.version } };
    });
  }

  /**
   * GET .../conflicts — quét + cache vào timetable_conflicts.
   * Trùng GV/lớp/phòng không thể tồn tại (unique index); thứ quét là
   * thiếu/thừa tiết và vi phạm ô khai báo bận.
   */
  async conflicts(timetableId: string): Promise<{ data: ConflictOut[] }> {
    const conflicts = await this.db.tx(async (sql) => {
      const yid = await this.yidOf(sql, timetableId);
      const assignments = await sql`
        SELECT a.id AS "assignmentId", ac.class_id AS "classId",
               a.periods_per_week AS "periodsPerWeek",
               s.short_name AS "subjectShort", c.name AS "className",
               COALESCE(p.placed, 0)::int AS placed
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        JOIN subjects s ON s.id = a.subject_id
        JOIN classes c ON c.id = ac.class_id
        LEFT JOIN (
          SELECT assignment_id, COUNT(*) AS placed
          FROM lessons WHERE timetable_id = ${timetableId}
          GROUP BY assignment_id
        ) p ON p.assignment_id = a.id`;

      const busyViolations = (await sql`
        SELECT DISTINCT l.id AS "lessonId", 'teacher' AS axis,
               t.id AS "ownerId", COALESCE(t.short_name, t.full_name) AS "ownerName",
               l.day_of_week AS "dayOfWeek", p.name AS "periodLabel",
               s2.short_name AS "subjectShort"
        FROM lessons l
        JOIN lesson_teachers lt ON lt.lesson_id = l.id
        JOIN teachers t ON t.id = lt.teacher_id
        JOIN periods p ON p.id = l.period_id
        JOIN subjects s2 ON s2.id = l.subject_id
        JOIN availability_slots av ON av.owner_type = 'teacher'
           AND av.owner_id = t.id AND av.preference = 'busy'
           AND av.school_year_id = ${yid}
           AND av.day_of_week = l.day_of_week AND av.period_id = l.period_id
        WHERE l.timetable_id = ${timetableId}
        UNION
        SELECT DISTINCT l.id, 'class', c.id, c.name,
               l.day_of_week, p.name, s2.short_name
        FROM lessons l
        JOIN lesson_classes lc ON lc.lesson_id = l.id
        JOIN classes c ON c.id = lc.class_id
        JOIN periods p ON p.id = l.period_id
        JOIN subjects s2 ON s2.id = l.subject_id
        JOIN availability_slots av ON av.owner_type = 'class'
           AND av.owner_id = c.id AND av.preference = 'busy'
           AND av.school_year_id = ${yid}
           AND av.day_of_week = l.day_of_week AND av.period_id = l.period_id
        WHERE l.timetable_id = ${timetableId}`).map((v: any) => ({
          ...v, dayOfWeek: Number(v.dayOfWeek),
        }));

      const [frame] = await sql`
        SELECT (SELECT COUNT(*)::int FROM periods WHERE school_year_id = ${yid})
             * cardinality(active_days) AS frame
        FROM school_years WHERE id = ${yid}`;

      return scanConflicts({
        assignments: assignments.map((a: any) => ({
          ...a, placed: Number(a.placed), periodsPerWeek: Number(a.periodsPerWeek)
        })),
        busyViolations,
        frameSlots: Number(frame?.frame ?? 0),
      });
    });

    // Cache cho màn hình Kiểm tra + tra nhanh
    await this.db.tx(async (sql) => {
      await sql`DELETE FROM timetable_conflicts WHERE timetable_id = ${timetableId}`;
      for (const c of conflicts) {
        await sql`
          INSERT INTO timetable_conflicts (timetable_id, kind, severity, subject_ref, message)
          VALUES (${timetableId}, ${c.kind}, ${c.severity},
                  ${JSON.stringify(c.refs)}::jsonb, ${c.message})`;
      }
    });

    return { data: conflicts };
  }

  /**
   * POST /lessons/:lid/swap — chiến lược bắt buộc từ tkb_api_spec.md §4.6:
   * partial unique index KHÔNG deferrable được, nên hoán đổi phải đi qua
   * DELETE cả hai tiết (bảng con cascade) rồi INSERT lại với ô đã đổi,
   * tất cả trong một transaction. Id thay đổi -> trả idMap cho client.
   */
  async swap(lid: string, withLessonId: string) {
    if (lid === withLessonId) {
      throw new ApiError(400, 'SAME_LESSON', 'Không thể hoán đổi một tiết với chính nó.');
    }
    return this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT l.id, l.school_id, l.timetable_id, l.assignment_id, l.subject_id,
               l.day_of_week, p.id AS period_id, l.room_id, l.is_pinned,
               t.version, t.status
        FROM lessons l
        JOIN timetables t ON t.id = l.timetable_id
        JOIN periods p ON p.id = l.period_id
        WHERE l.id = ANY(${[lid, withLessonId]}::uuid[])`;
      if (rows.length !== 2) throw notFound('một trong hai tiết học');
      const A = rows.find((r: any) => r.id === lid)!;
      const B = rows.find((r: any) => r.id === withLessonId)!;

      if (A.timetable_id !== B.timetable_id) {
        throw new ApiError(400, 'SWAP_CROSS_TIMETABLE', 'Hai tiết phải thuộc cùng một thời khoá biểu.');
      }
      if (A.status === 'published') {
        throw new ApiError(409, 'TIMETABLE_LOCKED', 'Thời khoá biểu đã công bố, không thể chỉnh sửa.');
      }
      if (A.is_pinned || B.is_pinned) {
        throw new ApiError(409, 'LESSON_PINNED', 'Có tiết đã bị ghim — bỏ ghim trước khi đổi chỗ.');
      }

      // Snapshot bảng con trước khi xoá (cascade sẽ xoá chúng)
      const childClasses = await sql`
        SELECT lesson_id, class_id, section_id FROM lesson_classes
        WHERE lesson_id = ANY(${[lid, withLessonId]}::uuid[])`;
      const childTeachers = await sql`
        SELECT lesson_id, teacher_id FROM lesson_teachers
        WHERE lesson_id = ANY(${[lid, withLessonId]}::uuid[])`;

      await sql`DELETE FROM lessons WHERE id = ANY(${[lid, withLessonId]}::uuid[])`;

      const [newA] = await sql`
        INSERT INTO lessons (school_id, timetable_id, assignment_id, subject_id,
                             day_of_week, period_id, room_id, is_pinned)
        VALUES (${A.school_id}, ${A.timetable_id}, ${A.assignment_id}, ${A.subject_id},
                ${B.day_of_week}, ${B.period_id}, ${A.room_id}, false)
        RETURNING id`;
      const [newB] = await sql`
        INSERT INTO lessons (school_id, timetable_id, assignment_id, subject_id,
                             day_of_week, period_id, room_id, is_pinned)
        VALUES (${B.school_id}, ${B.timetable_id}, ${B.assignment_id}, ${B.subject_id},
                ${A.day_of_week}, ${A.period_id}, ${B.room_id}, false)
        RETURNING id`;

      for (const c of childClasses.filter((x: any) => x.lesson_id === lid)) {
        await sql`INSERT INTO lesson_classes (lesson_id, class_id, section_id)
                  VALUES (${newA.id}, ${c.class_id}, ${c.section_id})`;
      }
      for (const c of childClasses.filter((x: any) => x.lesson_id === withLessonId)) {
        await sql`INSERT INTO lesson_classes (lesson_id, class_id, section_id)
                  VALUES (${newB.id}, ${c.class_id}, ${c.section_id})`;
      }
      for (const t of childTeachers.filter((x: any) => x.lesson_id === lid)) {
        await sql`INSERT INTO lesson_teachers (lesson_id, teacher_id)
                  VALUES (${newA.id}, ${t.teacher_id})`;
      }
      for (const t of childTeachers.filter((x: any) => x.lesson_id === withLessonId)) {
        await sql`INSERT INTO lesson_teachers (lesson_id, teacher_id)
                  VALUES (${newB.id}, ${t.teacher_id})`;
      }

      const [tt] = await sql`SELECT version FROM timetables WHERE id = ${A.timetable_id}`;
      return {
        idMap: { [lid]: newA.id, [withLessonId]: newB.id },
        timetable: { version: tt.version }
      };
    });
  }
}
