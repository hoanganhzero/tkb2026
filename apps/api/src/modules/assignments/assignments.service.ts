import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { buildTableXlsx } from '../export/xlsx.ts';
import {
  buildMatrix, planApply,
  type ClassRow, type SubjectRow, type RawAssignment,
  type ConfigRow, type PoolRow, type MatrixPayload,
  type ApplyItem, type ApplyOp
} from './matrix.ts';

@Injectable()
export class AssignmentsService {
  constructor(private db: DbService) {}

  /** GET .../assignments/matrix — payload cho màn hình phân công §7 */
  async matrix(yid: string): Promise<MatrixPayload> {
    const [classes, subjects, assignments, configs, pool] =
      await this.loadAll(yid);
    return buildMatrix({ classes, subjects, assignments, configs, teacherPool: pool });
  }

  private async loadAll(yid: string) {
    return this.db.tx(async (sql) => {
      const classes: ClassRow[] = await sql`
        SELECT c.id, c.name, c.grade_id AS "gradeId", g.ordinal AS "gradeOrdinal"
        FROM classes c JOIN grades g ON g.id = c.grade_id
        WHERE c.school_year_id = ${yid}
        ORDER BY g.ordinal, c.name`;

      const subjects: SubjectRow[] = await sql`
        SELECT id, code, short_name AS "shortName", name, color
        FROM subjects WHERE school_year_id = ${yid} AND is_active = true
        ORDER BY sort_order, code`;

      const acRows = await sql`
        SELECT a.id AS "assignmentId", a.subject_id AS "subjectId",
               ac.class_id AS "classId", a.periods_per_week AS "periodsPerWeek"
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        WHERE a.school_year_id = ${yid}`;
      const tRows = await sql`
        SELECT at.assignment_id AS "assignmentId", at.teacher_id AS "teacherId"
        FROM assignment_teachers at
        JOIN assignments a ON a.id = at.assignment_id
        WHERE a.school_year_id = ${yid}`;
      const teachersByA = new Map<string, string[]>();
      for (const r of tRows) {
        const arr = teachersByA.get(r.assignmentId) ?? [];
        arr.push(r.teacherId);
        teachersByA.set(r.assignmentId, arr);
      }
      const assignments: RawAssignment[] = acRows.map((r: any) => ({
        ...r,
        teacherIds: teachersByA.get(r.assignmentId) ?? []
      }));

      const configs: ConfigRow[] = await sql`
        SELECT sgc.subject_id AS "subjectId", sgc.grade_id AS "gradeId",
               sgc.periods_per_week AS "periodsPerWeek"
        FROM subject_grade_configs sgc
        JOIN grades g ON g.id = sgc.grade_id
        WHERE sgc.school_year_id = ${yid}`;

      const poolBase = await sql`
        SELECT t.id, t.full_name AS name, t.short_name AS short,
               t.max_periods_per_week AS "maxPeriods",
               COALESCE(l.total, 0) AS assigned
        FROM teachers t
        LEFT JOIN (
          SELECT at.teacher_id, SUM(a.periods_per_week) AS total
          FROM assignment_teachers at
          JOIN assignments a ON a.id = at.assignment_id
          WHERE a.school_year_id = ${yid}
          GROUP BY at.teacher_id
        ) l ON l.teacher_id = t.id
        WHERE t.school_year_id = ${yid} AND t.is_active = true`;
      const subjPairs = await sql`
        SELECT ts.teacher_id, ts.subject_id
        FROM teacher_subjects ts
        JOIN teachers t ON t.id = ts.teacher_id
        WHERE t.school_year_id = ${yid}`;
      const subjByT = new Map<string, string[]>();
      for (const p of subjPairs) {
        const arr = subjByT.get(p.teacher_id) ?? [];
        arr.push(p.subject_id);
        subjByT.set(p.teacher_id, arr);
      }
      const pool: PoolRow[] = poolBase.map((t: any) => ({
        id: t.id, name: t.name, short: t.short,
        maxPeriods: t.maxPeriods, assigned: Number(t.assigned),
        subjectIds: subjByT.get(t.id) ?? []
      }));

      return [classes, subjects, assignments, configs, pool] as const;
    });
  }

  /**
   * POST .../assignments/bulk — áp trạng thái từng ô (api spec §2).
   * Ô không xuất hiện trong items GIỮ NGUYÊN; periodsPerWeek=0 xoá rõ ràng.
   * Ghép lớp: xoá một lớp khỏi assignment nhiều lớp chỉ gỡ assignment_classes;
   * cập nhật ppw ảnh hưởng chung các lớp ghép (đúng nghĩa tiết học chung).
   */
  async applyBulk(yid: string, itemsIn: ApplyItem[]) {
    return this.db.tx(async (sql) => {
      const acRows = await sql`
        SELECT a.id AS "assignmentId", a.subject_id AS "subjectId",
               ac.class_id AS "classId", a.periods_per_week AS "periodsPerWeek",
               (SELECT COUNT(*)::int FROM assignment_classes x
                 WHERE x.assignment_id = a.id) AS "classCount"
        FROM assignments a
        JOIN assignment_classes ac ON ac.assignment_id = a.id
        WHERE a.school_year_id = ${yid}`;
      const tRows = await sql`
        SELECT at.assignment_id AS "assignmentId", at.teacher_id AS "teacherId"
        FROM assignment_teachers at
        JOIN assignments a ON a.id = at.assignment_id
        WHERE a.school_year_id = ${yid}`;
      const tByA = new Map<string, string[]>();
      for (const r of tRows) {
        const arr = tByA.get(r.assignmentId) ?? [];
        arr.push(r.teacherId);
        tByA.set(r.assignmentId, arr);
      }

      const qualifiedRows = await sql`
        SELECT ts.subject_id, ts.teacher_id
        FROM teacher_subjects ts
        JOIN teachers t ON t.id = ts.teacher_id
        WHERE t.school_year_id = ${yid}`;
      const qualified = new Map<string, Set<string>>();
      for (const q of qualifiedRows) {
        const set = qualified.get(q.subject_id) ?? new Set<string>();
        set.add(q.teacher_id);
        qualified.set(q.subject_id, set);
      }

      const existing = acRows.map((r: any) => ({
        assignmentId: r.assignmentId,
        subjectId: r.subjectId,
        classId: r.classId,
        periodsPerWeek: r.periodsPerWeek,
        teacherIds: tByA.get(r.assignmentId) ?? [],
      }));
      const meta = new Map(acRows.map((r: any) =>
        [`${r.classId}|${r.subjectId}`, r] as const));

      const { ops, warnings } = planApply(existing, qualified, itemsIn);

      let done = 0;
      for (const op of ops) {
        await this.execOp(sql as any, yid, op, meta);
        done++;
      }
      return { appliedOps: done, warnings };
    });
  }

  private async execOp(
    sql: any, yid: string,
    op: ApplyOp,
    meta: Map<string, any>,
  ) {
    if (op.kind === 'create') {
      const [a] = await sql`
        INSERT INTO assignments (school_id, school_year_id, subject_id, periods_per_week)
        VALUES (current_school_id(), ${yid}, ${op.subjectId}, ${op.periodsPerWeek})
        RETURNING id`;
      await sql`INSERT INTO assignment_classes (assignment_id, class_id)
                VALUES (${a.id}, ${op.classId})`;
      let primary = true;
      for (const tid of op.teacherIds ?? []) {
        await sql`INSERT INTO assignment_teachers (assignment_id, teacher_id, is_primary)
                  VALUES (${a.id}, ${tid}, ${primary})`;
        primary = false;
      }
      return;
    }

    if (op.kind === 'delete') {
      const m = meta.get(`${op.classId}|${op.subjectId}`);
      if (!m) return;
      if ((m.classCount ?? 1) > 1) {
        // Ghép lớp: chỉ gỡ lớp này khỏi tiết chung
        await sql`DELETE FROM assignment_classes
                  WHERE assignment_id = ${m.assignmentId} AND class_id = ${op.classId}`;
      } else {
        await sql`DELETE FROM assignments WHERE id = ${m.assignmentId}`;
      }
      return;
    }

    if (op.kind === 'update_ppw') {
      await sql`UPDATE assignments SET periods_per_week = ${op.periodsPerWeek}
                WHERE id = ${op.assignmentId}`;
      return;
    }

    if (op.kind === 'update_teachers') {
      await sql`DELETE FROM assignment_teachers WHERE assignment_id = ${op.assignmentId}`;
      let primary = true;
      for (const tid of op.teacherIds ?? []) {
        await sql`INSERT INTO assignment_teachers (assignment_id, teacher_id, is_primary)
                  VALUES (${op.assignmentId}, ${tid}, ${primary})`;
        primary = false;
      }
    }
  }

  /**
   * GET .../export.xlsx?kind=assignments|workload — hai báo cáo bảng
   * (các loại còn lại theo export design §3: TODO).
   */
  async exportXlsx(yid: string, kind: 'assignments' | 'workload', sid: string) {
    const [schoolRow] = await this.db.tx(async (sql) => {
      const [s] = await sql`SELECT name FROM schools WHERE id = ${sid}`;
      return [s?.name ?? 'Trường học'];
    });
    const school = schoolRow;
    const [, subjects, assignments, , pool] = await this.loadAll(yid);
    const subjById = new Map(subjects.map((s) => [s.id, s] as const));

    if (kind === 'workload') {
      const rows = [...pool]
        .sort((a, b) => b.assigned - a.assigned)
        .map((t) => {
          const lim = t.maxPeriods ?? 0;
          const delta = lim ? t.assigned - lim : 0;
          return [
            t.id.slice(0, 8), t.name,
            t.subjectIds.map((sid) => subjById.get(sid)?.shortName ?? '').join(', '),
            t.subjectIds.length, t.assigned, lim || '—', delta,
          ] as Array<string | number>;
        });
      return buildTableXlsx({
        title: 'BẢNG TẢI GIẢNG DẠY GIÁO VIÊN',
        school,
        headers: ['Mã', 'Họ và tên', 'Môn', 'Số lớp', 'Tiết/tuần', 'Định mức', 'Chênh lệch'],
        rows,
        deltaColIndex: 6,
      });
    }

    // kind === 'assignments' — ma trận dọc mỗi dòng một phân công (nhập lại được)
    const teacherName = new Map(pool.map((p) => [p.id, p.name] as const));
    const clsById = new Map<string, string>();
    void clsById;
    const classRows = await this.db.tx(async (sql) =>
      sql`SELECT id, name FROM classes WHERE school_year_id = ${yid}`);
    const classNameOf = new Map(classRows.map((c: any) => [c.id, c.name] as const));
    const subjCode = new Map(subjects.map((s) => [s.id, s.code] as const));

    const rows = assignments
      .slice()
      .sort((a, b) =>
        (classNameOf.get(a.classId) ?? '').localeCompare(classNameOf.get(b.classId) ?? '', 'vi') ||
        a.subjectId.localeCompare(b.subjectId))
      .map((a) => [
        classNameOf.get(a.classId) ?? '?',
        subjCode.get(a.subjectId) ?? '?',
        a.teacherIds.map((tid) => teacherName.get(tid) ?? tid.slice(0, 8)).join(', '),
        a.periodsPerWeek,
      ] as Array<string | number>);

    return buildTableXlsx({
      title: 'PHÂN CÔNG GIẢNG DẠY',
      school,
      headers: ['Lớp', 'Môn', 'Giáo viên', 'Tiết/tuần'],
      rows,
    });
  }

  /** GET .../assignments/validation — danh sách cảnh báo trên dữ liệu đã lưu */
  async validation(yid: string) {
    const payload = await this.matrix(yid);
    const issues: Array<{ level: 'error' | 'warning'; message: string; refs?: unknown }> = [];

    const frame = await this.db.tx(async (sql) => {
      const [p] = await sql`
        SELECT COUNT(*)::int AS n FROM periods
        WHERE school_year_id = ${yid}`;
      const [y] = await sql`
        SELECT cardinality(active_days) AS d FROM school_years WHERE id = ${yid}`;
      return (p?.n ?? 0) * (y?.d ?? 6);
    });

    for (const t of payload.totals.byClass) {
      const cls = payload.classes.find((c) => c.id === t.classId);
      if (frame && t.assigned > frame) {
        issues.push({ level: 'error',
          message: `Lớp ${cls?.name ?? t.classId} được phân công ${t.assigned} tiết nhưng khung chỉ có ${frame} ô`,
          refs: { classId: t.classId } });
      }
      if (t.standard && t.assigned < t.standard) {
        issues.push({ level: 'warning',
          message: `Lớp ${cls?.name ?? t.classId} thiếu ${t.standard - t.assigned} tiết so với chuẩn khối`,
          refs: { classId: t.classId, assigned: t.assigned, standard: t.standard } });
      }
    }

    for (const p of payload.teacherPool) {
      if (p.maxPeriods != null && p.assigned > p.maxPeriods) {
        issues.push({ level: 'warning',
          message: `${p.name}: ${p.assigned} tiết, vượt định mức ${p.maxPeriods} tiết`,
          refs: { teacherId: p.id, assigned: p.assigned, limit: p.maxPeriods } });
      }
    }

    return { data: issues };
  }
}
