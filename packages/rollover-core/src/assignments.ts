/**
 * Mang phân công sang năm mới (rollover doc §6):
 *  - KHÔNG sao chép số tiết cũ — lấy từ cấu hình chuẩn của khối MỚI (§6.1)
 *  - Hai chế độ: 'followClass' GV theo lớp lên · 'keepGrade' GV giữ khối (§6.2)
 *  - Ghi đè theo tổ bộ môn qua deptMode override
 *  - Cảnh báo: GV nghỉ, vượt định mức, lớp thiếu môn, môn không còn (§6.3)
 */

export type AssignMode = 'followClass' | 'keepGrade';

export interface OldAssignment {
  id: string;
  subjectId: string;
  classId: string;
  teacherId: string | null;
}

export interface NewClass {
  id: string;
  name: string;
  gradeOrdinal: number;
  sourceId: string | null;   // promote -> source; create -> null
}

export interface SubjectGradeConfig {
  subjectId: string;
  gradeOrdinal: number;
  periodsPerWeek: number;
}

export interface AssignWarning {
  kind: 'RETIRED_TEACHER' | 'OVER_LIMIT' | 'CLASS_MISSING_SUBJECT' | 'SUBJECT_GONE';
  message: string;
  refs?: Record<string, unknown>;
}

export interface MappedAssignment {
  sourceAssignmentId: string;
  subjectId: string;
  newClassId: string;
  teacherId: string | null;
  periodsPerWeek: number;
  auto: boolean;
}

export interface AssignMapOptions {
  mode: AssignMode;
  /** Ghi đè theo tổ bộ môn: subjectId -> mode (§6.2) */
  deptOverrides?: Record<string, AssignMode>;
  /** GV đã đánh dấu nghỉ ở bước giáo viên */
  retiredTeacherIds?: Set<string>;
  limits?: Map<string, number>;   // teacherId -> định mức tiết/tuần
}

export interface AssignMapResult {
  assignments: MappedAssignment[];
  warnings: AssignWarning[];
}

export function mapAssignments(
  oldAssignments: OldAssignment[],
  oldClasses: Array<{ id: string; gradeOrdinal: number }>,
  newClasses: NewClass[],
  configs: SubjectGradeConfig[],
  allSubjectIds: ReadonlySet<string>,
  opts: AssignMapOptions,
): AssignMapResult {
  const warnings: AssignWarning[] = [];
  const out: MappedAssignment[] = [];

  const oldGradeOf = new Map(oldClasses.map((c) => [c.id, c.gradeOrdinal] as const));
  const cfg = (subj: string, grade: number): number | undefined =>
    configs.find((c) => c.subjectId === subj && c.gradeOrdinal === grade)?.periodsPerWeek;

  // Lớp đích cho followClass: qua ánh xạ promote (sourceId khớp)
  const promotedBySource = new Map<string, NewClass>();
  for (const nc of newClasses) {
    if (nc.sourceId) promotedBySource.set(nc.sourceId, nc);
  }
  // Lớp đích cho keepGrade: lớp mới CÙNG KHỐI với lớp cũ
  const newClassesByGrade = new Map<number, NewClass[]>();
  for (const nc of newClasses) {
    const arr = newClassesByGrade.get(nc.gradeOrdinal) ?? [];
    arr.push(nc);
    newClassesByGrade.set(nc.gradeOrdinal, arr);
  }

  const covered = new Set<string>(); // `${newClassId}|${subjectId}`

  for (const oa of oldAssignments) {
    const mode = opts.deptOverrides?.[oa.subjectId] ?? opts.mode;
    const oldGrade = oldGradeOf.get(oa.classId);
    if (oldGrade === undefined) continue;

    let target: NewClass | undefined;
    if (mode === 'followClass') {
      target = promotedBySource.get(oa.classId);
    } else {
      target = newClassesByGrade.get(oldGrade)?.[0];
    }
    if (!target) continue; // graduate/skip/rebuild — không mang

    if (!allSubjectIds.has(oa.subjectId)) {
      warnings.push({
        kind: 'SUBJECT_GONE',
        message: `Môn không còn trong danh sách năm mới — bỏ phân công ${oa.id}`,
        refs: { assignmentId: oa.id, subjectId: oa.subjectId },
      });
      continue;
    }

    const ppw = cfg(oa.subjectId, target.gradeOrdinal);
    const retired = oa.teacherId != null && opts.retiredTeacherIds?.has(oa.teacherId);
    const teacherId = retired ? null : oa.teacherId;
    if (retired && oa.teacherId) {
      warnings.push({
        kind: 'RETIRED_TEACHER',
        message: `Phân công trỏ tới giáo viên đã nghỉ — cần gán lại`,
        refs: { assignmentId: oa.id, teacherId: oa.teacherId, newClassId: target.id },
      });
    }

    out.push({
      sourceAssignmentId: oa.id,
      subjectId: oa.subjectId,
      newClassId: target.id,
      teacherId,
      periodsPerWeek: ppw ?? 0,
      auto: true,
    });
    covered.add(`${target.id}|${oa.subjectId}`);
  }

  // Lớp mới thiếu môn so với tập môn từng dạy ở khối đó (§6.3 loại 3)
  const subjectsPerOldGrade = new Map<number, Set<string>>();
  for (const oa of oldAssignments) {
    const g = oldGradeOf.get(oa.classId);
    if (g === undefined) continue;
    const set = subjectsPerOldGrade.get(g) ?? new Set<string>();
    set.add(oa.subjectId);
    subjectsPerOldGrade.set(g, set);
  }
  for (const nc of newClasses) {
    const expected = subjectsPerOldGrade.get(nc.gradeOrdinal);
    if (!expected) continue;
    for (const sj of expected) {
      if (!covered.has(`${nc.id}|${sj}`)) {
        warnings.push({
          kind: 'CLASS_MISSING_SUBJECT',
          message: `Lớp ${nc.name} chưa có phân công môn đã khai ở khối này`,
          refs: { classId: nc.id, subjectId: sj },
        });
      }
    }
  }

  // Vượt định mức sau khi mang sang (§6.3 loại 2)
  if (opts.limits) {
    const totals = new Map<string, number>();
    for (const a of out) {
      if (!a.teacherId) continue;
      totals.set(a.teacherId, (totals.get(a.teacherId) ?? 0) + a.periodsPerWeek);
    }
    for (const [tid, total] of totals) {
      const limit = opts.limits.get(tid);
      if (limit !== undefined && total > limit) {
        warnings.push({
          kind: 'OVER_LIMIT',
          message: `GV vượt định mức sau khi mang sang: ${total}/${limit} tiết`,
          refs: { teacherId: tid, total, limit },
        });
      }
    }
  }

  return { assignments: out, warnings };
}
