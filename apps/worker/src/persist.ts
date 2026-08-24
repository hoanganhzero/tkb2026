/**
 * Ghi kết quả solver vào DB — solver spec §12.3.
 * buildPersistStatements() là phần thuần (test được): trả danh sách statement
 * theo ĐÚNG THỨ TỰ snapshot -> delete -> insert -> children -> update,
 * để persistResult() chỉ việc chạy tuần tự trong một transaction.
 * Trigger trg_bump_ver_* ở schema tự tăng version — không UPDATE version tay.
 */

export interface PersistInput {
  timetableId: string;
  schoolId: string;
  softScore: number;
  snapshotPayload: unknown;
  writes: Array<{
    assignmentId: string;
    subjectId: string;
    dayOfWeek: number;      // 1..7 ISO
    periodId: string;
    classIds: string[];
    teacherIds: string[];
  }>;
}

export interface Statement { name: string; text: string; values: unknown[] }

export const PERSIST_ORDER = ['snapshot', 'delete', 'insert_lessons', 'insert_classes', 'insert_teachers', 'update_tt'] as const;

export function buildPersistStatements(p: PersistInput): Statement[] {
  const lessonAssignments = p.writes.map((w) => w.assignmentId);
  const lessonSubjects = p.writes.map((w) => w.subjectId);
  const lessonDows = p.writes.map((w) => w.dayOfWeek);
  const lessonPeriods = p.writes.map((w) => w.periodId);

  const classPairs: Array<{ a: string; dow: number; per: string; cid: string }> = [];
  const teacherPairs: Array<{ a: string; dow: number; per: string; tid: string }> = [];
  for (const w of p.writes) {
    for (const cid of w.classIds) classPairs.push({ a: w.assignmentId, dow: w.dayOfWeek, per: w.periodId, cid });
    for (const tid of w.teacherIds) teacherPairs.push({ a: w.assignmentId, dow: w.dayOfWeek, per: w.periodId, tid });
  }

  return [
    {
      name: 'snapshot',
      text: `INSERT INTO timetable_snapshots (timetable_id, label, payload, soft_score)
             VALUES ($1, $2, $3::jsonb, $4)`,
      values: [p.timetableId, 'Trước khi xếp tự động', JSON.stringify(p.snapshotPayload), p.softScore]
    },
    {
      name: 'delete',
      // Giữ nguyên tiết ghim — solver cũng không đụng chúng
      text: `DELETE FROM lessons WHERE timetable_id = $1 AND is_pinned = false`,
      values: [p.timetableId]
    },
    {
      name: 'insert_lessons',
      text: `INSERT INTO lessons (school_id, timetable_id, assignment_id, subject_id, day_of_week, period_id)
             SELECT $2, $1, u.assignment_id, u.subject_id, u.day_of_week, u.period_id
             FROM unnest($3::uuid[], $4::uuid[], $5::int[], $6::text[]) AS u(assignment_id, subject_id, day_of_week, period_id)`,
      values: [p.timetableId, p.schoolId, lessonAssignments, lessonSubjects, lessonDows, lessonPeriods]
    },
    {
      name: 'insert_classes',
      text: `INSERT INTO lesson_classes (lesson_id, class_id)
             SELECT l.id, u.class_id
             FROM lessons l
             JOIN unnest($2::uuid[], $3::int[], $4::text[], $5::uuid[]) AS u(assignment_id, day_of_week, period_id, class_id)
               ON l.assignment_id = u.assignment_id
              AND l.day_of_week = u.day_of_week
              AND l.period_id = u.period_id
             WHERE l.timetable_id = $1`,
      values: [p.timetableId,
        classPairs.map((x) => x.a), classPairs.map((x) => x.dow),
        classPairs.map((x) => x.per), classPairs.map((x) => x.cid)]
    },
    {
      name: 'insert_teachers',
      text: `INSERT INTO lesson_teachers (lesson_id, teacher_id)
             SELECT l.id, u.teacher_id
             FROM lessons l
             JOIN unnest($2::uuid[], $3::int[], $4::text[], $5::uuid[]) AS u(assignment_id, day_of_week, period_id, teacher_id)
               ON l.assignment_id = u.assignment_id
              AND l.day_of_week = u.day_of_week
              AND l.period_id = u.period_id
             WHERE l.timetable_id = $1`,
      values: [p.timetableId,
        teacherPairs.map((x) => x.a), teacherPairs.map((x) => x.dow),
        teacherPairs.map((x) => x.per), teacherPairs.map((x) => x.tid)]
    },
    {
      name: 'update_tt',
      text: `UPDATE timetables SET status = 'ready', soft_score = $2, hard_violations = 0
             WHERE id = $1`,
      values: [p.timetableId, p.softScore]
    }
  ];
}

/** Chạy tuần tự trong một transaction — nhận postgres TransactionSql tương thích. */
export async function persistResult(tx: { unsafe(text: string, params?: unknown[]): Promise<any> }, p: PersistInput): Promise<void> {
  for (const s of buildPersistStatements(p)) {
    await tx.unsafe(s.text, s.values);
  }
}
