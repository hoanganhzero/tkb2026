import { Body, Controller, Get, Injectable, Module, Param, Post, Query } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { ApiError } from '../../common/api-error.js';
import {
  mapClasses, mapAssignments,
  type ClassMapping, type AssignWarning, type MappedAssignment
} from '@tkb/rollover-core';

/**
 * Chuyển tiếp năm học — PHASE 1: PREVIEW (đọc, không ghi).
 * Áp dụng thật (§7.1 transaction 9 bước) sẽ là POST /apply ở phiên sau.
 */

@Injectable()
export class RolloverService {
  constructor(private db: DbService) {}

  async preview(schoolId: string, q: {
    fromYearId: string;
    shuffleGrades?: string;      // '10,11'
    intakeCount?: number;
    intakePattern?: string;      // '10A#'
    retiredTeacherIds?: string;  // csv uuid
    mode?: 'followClass' | 'keepGrade';
  }) {
    return this.db.tx(async (sql) => {
      const [year] = await sql`
        SELECT id, name FROM school_years WHERE id = ${q.fromYearId} AND school_id = ${schoolId}`;
      if (!year) throw new ApiError(404, 'NOT_FOUND', 'Không tìm thấy năm học nguồn.');

      const grades = await sql`
        SELECT id, ordinal FROM grades WHERE school_year_id = ${q.fromYearId} ORDER BY ordinal`;
      if (grades.length < 2) {
        throw new ApiError(422, 'BAD_SPAN', 'Năm học cần ít nhất 2 khối để chuyển tiếp.');
      }
      const span = { first: Number(grades[0].ordinal), last: Number(grades[grades.length - 1].ordinal) };

      const oldClasses = await sql`
        SELECT c.id, c.name, c.grade_id AS gid, g.ordinal AS grade,
               c.homeroom_teacher_id AS homeroom
        FROM classes c JOIN grades g ON g.id = c.grade_id
        WHERE c.school_year_id = ${q.fromYearId} ORDER BY g.ordinal, c.name`;

      const shuffleGrades = (q.shuffleGrades ?? '').split(',').map(Number).filter(Boolean);
      const mappings: ClassMapping[] = mapClasses(
        oldClasses.map((c: any) => ({
          id: c.id, name: c.name, gradeOrdinal: Number(c.grade),
          homeroomTeacherId: c.homeroom,
        })),
        {
          span,
          ...(Number(q.intakeCount) > 0 ? { intake: {
            gradeOrdinal: span.first,
            count: Number(q.intakeCount),
            namePattern: q.intakePattern ?? `${span.first}A#`
          }} : {}),
          ...(shuffleGrades.length ? { shuffleGrades } : {}),
        }
      );

      // Phân công: chỉ mang theo các lớp promote (giống logic rollover-core test)
      const promotedSourceIds = new Set(mappings.filter((m) => m.action === 'promote').map((m) => m.sourceId!));
      const newClasses = mappings.filter((m) => m.action === 'promote' && m.targetName).map((m) => ({
        id: `preview:${m.targetName}`, name: m.targetName!, gradeOrdinal: m.gradeOrdinal, sourceId: m.sourceId!,
      }));

      const oldAssignments = await sql`
        SELECT a.id, a.subject_id AS "subjectId", ac.class_id AS "classId",
               COALESCE((SELECT at.teacher_id FROM assignment_teachers at
                         WHERE at.assignment_id = a.id LIMIT 1), NULL) AS "teacherId"
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        WHERE a.school_year_id = ${q.fromYearId}`;

      const configs = await sql`
        SELECT sgc.subject_id AS "subjectId", g.ordinal AS "gradeOrdinal",
               sgc.periods_per_week AS "periodsPerWeek"
        FROM subject_grade_configs sgc JOIN grades g ON g.id = sgc.grade_id
        WHERE sgc.school_year_id = ${q.fromYearId}`;

      const subjects = await sql`SELECT id FROM subjects WHERE school_year_id = ${q.fromYearId}`;
      const subjectSet = new Set(subjects.map((s: any) => s.id));

      const teachers = await sql`
        SELECT id, max_periods_per_week AS lim FROM teachers WHERE school_year_id = ${q.fromYearId}`;
      const limits = new Map(teachers.map((t: any) => [t.id, t.lim ?? 19] as const));
      const retired = new Set((q.retiredTeacherIds ?? '').split(',').filter(Boolean));

      const mode = q.mode === 'keepGrade' ? 'keepGrade' as const : 'followClass' as const;
      const assignResult = mapAssignments(
        oldAssignments.map((a: any) => ({
          id: a.id, subjectId: a.subjectId, classId: a.classId, teacherId: a.teacherId
        })),
        oldClasses.map((c: any) => ({ id: c.id, gradeOrdinal: Number(c.grade) })),
        newClasses, configs.map((c: any) => ({
          subjectId: c.subjectId, gradeOrdinal: Number(c.gradeOrdinal), periodsPerWeek: Number(c.periodsPerWeek)
        })),
        subjectSet,
        { mode, retiredTeacherIds: retired, limits }
      );

      return {
        sourceYear: year.name,
        span,
        mappings,
        assignments: {
          mode,
          items: assignResult.assignments as MappedAssignment[],
        },
        warnings: assignResult.warnings as AssignWarning[],
      };
    });
  }

  /**
   * POST apply — §7.1 transaction MỘT LẦN, đúng thứ tự phụ thuộc:
   * năm học → học kỳ → khung tiết → khối → tổ → môn(+cấu hình) → phòng →
   * GV(+môn dạy+lịch bận cố định) → lớp(ánh xạ) → phân công(mang sang).
   * Mọi bản ghi mới mang source_id trỏ về năm cũ; hoàn tác = xoá năm mới.
   */
  async apply(schoolId: string, q: {
    fromYearId: string;
    targetYearName: string;
    shuffleGrades?: string;
    intakeCount?: number;
    intakePattern?: string;
    mode?: 'followClass' | 'keepGrade';
    retiredTeacherIds?: string;
  }) {
    if (!q.targetYearName?.trim()) {
      throw new ApiError(422, 'VALIDATION', 'Thiếu tên năm học đích.');
    }
    return this.db.tx(async (sql) => {
      // Chặn chạy hai lần cùng cặp năm (rollover doc §10 edge cases)
      const dup = await sql`
        SELECT id FROM school_years WHERE school_id = ${schoolId} AND name = ${q.targetYearName}`;
      if (dup.length) {
        throw new ApiError(409, 'TARGET_EXISTS', `Năm học "${q.targetYearName}" đã tồn tại.`);
      }

      /* ---------- 1. Năm học mới (is_active=false — người dùng tự bật) ---------- */
      const [target] = await sql`
        INSERT INTO school_years (school_id, name, is_active, active_days)
        SELECT school_id, ${q.targetYearName}, false, active_days
        FROM school_years WHERE id = ${q.fromYearId}
        RETURNING id`;

      /* ---------- 2–3. Học kỳ + khung tiết ---------- */
      await sql`
        INSERT INTO semesters (school_id, school_year_id, name, ordinal, start_date, end_date, source_id)
        SELECT ${schoolId}, ${target.id}, name, ordinal, start_date, end_date, id
        FROM semesters WHERE school_year_id = ${q.fromYearId}`;

      const periodMapRows = await sql`
        INSERT INTO periods (school_id, school_year_id, session, ordinal, name,
                             start_time, end_time, day_position, source_id)
        SELECT ${schoolId}, ${target.id}, session, ordinal, name,
               start_time, end_time, day_position, id
        FROM periods WHERE school_year_id = ${q.fromYearId}
        RETURNING id, source_id`;
      const newPeriodBySource = new Map(periodMapRows.map((r: any) => [r.source_id, r.id] as const));

      /* ---------- 4. Khối ---------- */
      await sql`
        INSERT INTO grades (school_id, school_year_id, name, ordinal, source_id)
        SELECT ${schoolId}, ${target.id}, name, ordinal, id
        FROM grades WHERE school_year_id = ${q.fromYearId}`;
      const newGrades = (await sql`
        SELECT id, ordinal FROM grades WHERE school_year_id = ${target.id}`) as unknown as
        Array<{ id: string; ordinal: number }>;
      const gradeIdByOrd = new Map(newGrades.map((g: any) => [Number(g.ordinal), g.id] as const));

      /* ---------- 5. Tổ bộ môn (head cập nhật sau khi có GV) ---------- */
      const deptMapRows = await sql`
        INSERT INTO departments (school_id, school_year_id, name, source_id)
        SELECT ${schoolId}, ${target.id}, name, id
        FROM departments WHERE school_year_id = ${q.fromYearId}
        RETURNING id, source_id`;
      const deptIdBySource = new Map(deptMapRows.map((r: any) => [r.source_id, r.id] as const));

      /* ---------- 6. Môn + cấu hình số tiết theo khối MỚI ---------- */
      const subjMapRows = await sql`
        INSERT INTO subjects (school_id, school_year_id, department_id, code, name, short_name,
                              color, difficulty, needs_special_room, prefer_double_period, source_id)
        SELECT ${schoolId}, ${target.id},
               d2.new_id, s.code, s.name, s.short_name, s.color, s.difficulty,
               s.needs_special_room, s.prefer_double_period, s.id
        FROM subjects s
        LEFT JOIN (SELECT source_id AS old_id, id AS new_id FROM departments
                   WHERE school_year_id = ${target.id}) d2 ON d2.old_id = s.department_id
        WHERE s.school_year_id = ${q.fromYearId}
        RETURNING id, source_id`;
      const subjIdBySource = new Map(subjMapRows.map((r: any) => [r.source_id, r.id] as const));

      const cfgRows = await sql`
        SELECT sgc.subject_id, g.ordinal AS grade_ord, sgc.periods_per_week
        FROM subject_grade_configs sgc JOIN grades g ON g.id = sgc.grade_id
        WHERE sgc.school_year_id = ${q.fromYearId}`;
      for (const c of cfgRows) {
        const newSubj = subjIdBySource.get(c.subject_id);
        const newGrade = gradeIdByOrd.get(Number(c.grade_ord));
        if (!newSubj || !newGrade) continue;
        await sql`
          INSERT INTO subject_grade_configs (school_id, subject_id, grade_id, periods_per_week)
          VALUES (${schoolId}, ${newSubj}, ${newGrade}, ${c.periods_per_week})`;
      }

      /* ---------- 7. Phòng học ---------- */
      await sql`
        INSERT INTO rooms (school_id, school_year_id, code, name, kind, capacity, building, floor, source_id)
        SELECT ${schoolId}, ${target.id}, code, name, kind, capacity, building, floor, id
        FROM rooms WHERE school_year_id = ${q.fromYearId}`;

      /* ---------- 8. Giáo viên + môn dạy + lịch bận CỐ ĐỊNH ---------- */
      const teacherMapRows = await sql`
        INSERT INTO teachers (school_id, school_year_id, code, full_name, short_name, gender,
                              email, phone, max_periods_per_week, max_periods_per_day,
                              max_days_per_week, department_id, source_id)
        SELECT ${schoolId}, ${target.id}, t.code, t.full_name, t.short_name, t.gender,
               t.email, t.phone, t.max_periods_per_week, t.max_periods_per_day,
               t.max_days_per_week, d2.new_id, t.id
        FROM teachers t
        LEFT JOIN (SELECT source_id AS old_id, id AS new_id FROM departments
                   WHERE school_year_id = ${target.id}) d2 ON d2.old_id = t.department_id
        WHERE t.school_year_id = ${q.fromYearId}
        RETURNING id, source_id`;
      const teacherIdBySource = new Map(teacherMapRows.map((r: any) => [r.source_id, r.id] as const));

      await sql`
        INSERT INTO teacher_subjects (teacher_id, subject_id)
        SELECT t2.new_id, s2.new_id
        FROM teacher_subjects ts
        JOIN (SELECT source_id AS old_id, id AS new_id FROM teachers WHERE school_year_id = ${target.id}) t2
          ON t2.old_id = ts.teacher_id
        JOIN (SELECT source_id AS old_id, id AS new_id FROM subjects WHERE school_year_id = ${target.id}) s2
          ON s2.old_id = ts.subject_id`;

      // CHỈ lịch bận cố định (is_recurring=true) — tạm thời của năm cũ không mang
      await sql`
        INSERT INTO availability_slots (school_id, school_year_id, owner_type, owner_id,
                                        day_of_week, period_id, preference, reason, is_recurring)
        SELECT ${schoolId}, ${target.id}, av.owner_type, m.new_id,
               av.day_of_week, p2.id, av.preference, av.reason, true
        FROM availability_slots av
        JOIN (SELECT source_id AS old_id, id AS new_id FROM teachers WHERE school_year_id = ${target.id}) m
          ON m.old_id = av.owner_id
        JOIN (SELECT source_id AS old_id, id AS new_id FROM periods WHERE school_year_id = ${target.id}) p2
          ON p2.old_id = av.period_id
        WHERE av.school_year_id = ${q.fromYearId}
          AND av.owner_type = 'teacher' AND av.is_recurring = true`;

      // Head tổ bộ môn cập nhật sau khi có GV
      await sql`
        UPDATE departments d SET head_teacher_id = m.new_id
        FROM (SELECT source_id AS old_id, id AS new_id FROM teachers WHERE school_year_id = ${target.id}) m
        WHERE d.school_year_id = ${target.id} AND d.source_id IS NOT NULL
          AND d.head_teacher_id IS NOT NULL AND m.old_id = (
            SELECT old.head_teacher_id FROM departments old WHERE old.id = d.source_id)`;

      /* ---------- Ánh xạ lớp: tái tính deterministic như preview ---------- */
      const oldClasses = await sql`
        SELECT c.id, c.name, c.grade_id AS gid, g.ordinal AS grade, c.homeroom_teacher_id AS homeroom
        FROM classes c JOIN grades g ON g.id = c.grade_id
        WHERE c.school_year_id = ${q.fromYearId} ORDER BY g.ordinal, c.name`;
      const mappings = mapClasses(
        oldClasses.map((c: any) => ({
          id: c.id, name: c.name, gradeOrdinal: Number(c.grade),
          homeroomTeacherId: c.homeroom,
        })),
        {
          span: spanOf(newGrades),
          ...(Number(q.intakeCount) > 0 ? { intake: {
            gradeOrdinal: spanOf(newGrades).first,
            count: Number(q.intakeCount),
            namePattern: q.intakePattern ?? `${spanOf(newGrades).first}A#`,
          }} : {}),
          ...(((q.shuffleGrades ?? '').split(',').map(Number).filter(Boolean).length)
            ? { shuffleGrades: q.shuffleGrades!.split(',').map(Number).filter(Boolean) } : {}),
        }
      );

      /* ---------- 9a. Lớp mới theo ánh xạ ---------- */
      const classIdBySource = new Map<string, string>();
      const newClassesForAssign: Array<{ id: string; name: string; gradeOrdinal: number; sourceId: string }> = [];
      for (const m of mappings) {
        if (m.action !== 'promote' || !m.targetName || !m.sourceId) continue;
        const gid = gradeIdByOrd.get(m.gradeOrdinal);
        if (!gid) continue;
        const homeroomNew = m.homeroomTeacherId ? teacherIdBySource.get(m.homeroomTeacherId) ?? null : null;
        const [nc] = await sql`
          INSERT INTO classes (school_id, school_year_id, grade_id, homeroom_teacher_id, name, source_id)
          VALUES (${schoolId}, ${target.id}, ${gid}, ${homeroomNew}, ${m.targetName}, ${m.sourceId})
          RETURNING id`;
        classIdBySource.set(m.sourceId, nc.id);
        newClassesForAssign.push({ id: nc.id, name: m.targetName, gradeOrdinal: m.gradeOrdinal, sourceId: m.sourceId });
      }

      /* ---------- 9b. Phân công mang sang (rollover-core) ---------- */
      const promotedSourceIds = new Set(mappings.filter((m) => m.action === 'promote').map((m) => m.sourceId!));
      const oldAssignments = await sql`
        SELECT a.id, a.subject_id AS "subjectId", ac.class_id AS "classId",
               COALESCE((SELECT at.teacher_id FROM assignment_teachers at
                         WHERE at.assignment_id = a.id LIMIT 1), NULL) AS "teacherId"
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        WHERE a.school_year_id = ${q.fromYearId}`;
      const configs = await sql`
        SELECT sgc.subject_id AS "subjectId", g.ordinal AS "gradeOrdinal",
               sgc.periods_per_week AS "periodsPerWeek"
        FROM subject_grade_configs sgc JOIN grades g ON g.id = sgc.grade_id
        WHERE sgc.school_year_id = ${q.fromYearId}`;
      const subjectsAll = await sql`SELECT id FROM subjects WHERE school_year_id = ${q.fromYearId}`;
      const limits = new Map<string, number>();
      for (const t of teacherMapRows) limits.set(t.id, t.lim ?? 19);

      const assignResult = mapAssignments(
        oldAssignments.map((a: any) => ({
          id: a.id, subjectId: a.subjectId, classId: a.classId, teacherId: a.teacherId
        })),
        oldClasses.map((c: any) => ({ id: c.id, gradeOrdinal: Number(c.grade) })),
        newClassesForAssign,
        configs.map((c: any) => ({
          subjectId: c.subjectId, gradeOrdinal: Number(c.gradeOrdinal), periodsPerWeek: Number(c.periodsPerWeek)
        })),
        new Set(subjectsAll.map((s: any) => s.id)),
        {
          mode: q.mode === 'keepGrade' ? 'keepGrade' : 'followClass',
          retiredTeacherIds: new Set((q.retiredTeacherIds ?? '').split(',').filter(Boolean)),
          limits,
        }
      );

      for (const a of assignResult.assignments) {
        if (!a.teacherId && !a.subjectId) continue;
        const [na] = await sql`
          INSERT INTO assignments (school_id, school_year_id, subject_id, periods_per_week, source_id)
          VALUES (${schoolId}, ${target.id},
                  ${subjIdBySource.get(a.subjectId) ?? null}, ${a.periodsPerWeek}, ${a.sourceAssignmentId})
          RETURNING id`;
        await sql`INSERT INTO assignment_classes (assignment_id, class_id)
                  VALUES (${na.id}, ${a.newClassId})`;
        if (a.teacherId) {
          const newTid = teacherIdBySource.get(a.teacherId);
          if (newTid) {
            await sql`INSERT INTO assignment_teachers (assignment_id, teacher_id, is_primary)
                      VALUES (${na.id}, ${newTid}, true)`;
          }
        }
      }

      /* ---------- Job record + hoàn tác 14 ngày ---------- */
      const warnings = assignResult.warnings;
      const [job] = await sql`
        INSERT INTO rollover_jobs (school_id, source_year_id, target_year_id,
                                   status, stats, warnings, undo_expires_at, applied_at)
        VALUES (${schoolId}, ${q.fromYearId}, ${target.id}, 'completed',
                ${JSON.stringify({
                  classes: classIdBySource.size,
                  assignments: assignResult.assignments.length,
                  teachers: teacherMapRows.length,
                })}::jsonb,
                ${JSON.stringify(warnings)}::jsonb,
                now() + interval '14 days', now())
        RETURNING id`;

      return {
        ok: true,
        targetYearId: target.id,
        jobId: job.id,
        stats: {
          classes: classIdBySource.size,
          assignments: assignResult.assignments.length,
          warnings: warnings.length,
        },
        undoHint: 'Hoàn tác bằng cách xoá năm học mới trong 14 ngày tới.',
      };
    });
  }
}

/** span từ danh sách grades mới (ordinal numbers) */
function spanOf(newGrades: Array<{ ordinal: number }>): { first: number; last: number } {
  const ords = newGrades.map((g) => Number(g.ordinal)).sort((a, b) => a - b);
  return { first: ords[0], last: ords[ords.length - 1] };
}

@Controller('schools/:sid/rollover')
export class RolloverController {
  constructor(private svc: RolloverService) {}

  @Get('preview')
  preview(
    @Param('sid') sid: string,
    @Query() q: Record<string, string>,
  ) {
    return this.svc.preview(sid, {
      fromYearId: q.fromYearId ?? '',
      shuffleGrades: q.shuffleGrades,
      intakeCount: q.intakeCount ? Number(q.intakeCount) : undefined,
      intakePattern: q.intakePattern,
      retiredTeacherIds: q.retiredTeacherIds,
      mode: q.mode === 'keepGrade' ? 'keepGrade' : 'followClass',
    });
  }

  @Post('apply')
  apply(
    @Param('sid') sid: string,
    @Body() body: {
      fromYearId: string; targetYearName: string;
      shuffleGrades?: string; intakeCount?: number; intakePattern?: string;
      mode?: 'followClass' | 'keepGrade'; retiredTeacherIds?: string;
    },
  ) {
    if (!body?.fromYearId) throw new ApiError(422, 'VALIDATION', 'Thiếu fromYearId.');
    return this.svc.apply(sid, {
      fromYearId: body.fromYearId,
      targetYearName: body.targetYearName ?? '',
      shuffleGrades: body.shuffleGrades,
      intakeCount: body.intakeCount ? Number(body.intakeCount) : undefined,
      intakePattern: body.intakePattern,
      mode: body.mode === 'keepGrade' ? 'keepGrade' : 'followClass',
      retiredTeacherIds: body.retiredTeacherIds,
    });
  }
}

@Module({
  controllers: [RolloverController],
  providers: [RolloverService]
})
export class RolloverModule {}
