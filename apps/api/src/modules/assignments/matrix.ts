/**
 * Ma trận Lớp × Môn — PHẦN THUẦN (test không cần DB).
 * Nguồn hình dạng màn hình: tkb_design_spec.md §7 (Tổng cột đỏ/thiếu, hàng
 * Tổng cuối, dropdown GV theo môn sắp theo tải tăng dần, ⛓ ghép lớp).
 */

export interface ClassRow {
  id: string; name: string; gradeId: string; gradeOrdinal: number;
}
export interface SubjectRow {
  id: string; code: string; shortName: string; name: string; color: string | null;
}
/** Một dòng join assignments × assignment_classes × assignment_teachers */
export interface RawAssignment {
  assignmentId: string;
  subjectId: string;
  classId: string;
  periodsPerWeek: number;
  teacherIds: string[];
}
export interface ConfigRow { subjectId: string; gradeId: string; periodsPerWeek: number }
export interface PoolRow {
  id: string; name: string; short: string | null;
  maxPeriods: number | null; assigned: number; subjectIds: string[];
}

export interface MatrixCell {
  assignmentId: string;
  subjectId: string;
  classId: string;
  periodsPerWeek: number;
  /** >1 phần tử = ghép lớp (client hiển thị badge ⛓) */
  teacherIds: string[];
}

export interface MatrixPayload {
  classes: ClassRow[];
  subjects: SubjectRow[];
  cells: MatrixCell[];
  /** Chuẩn số tiết theo (môn|khối-id) từ subject_grade_configs */
  standards: Record<string, number>;
  totals: {
    /** assigned so với chuẩn của khối — client tô đỏ thiếu / cam thừa */
    byClass: Array<{ classId: string; assigned: number; standard: number }>;
    /** Hàng Tổng cuối: tổng tiết mỗi môn toàn trường */
    bySubject: Array<{ subjectId: string; periods: number }>;
  };
  teacherPool: PoolRow[];
}

const key = (s: string, g: string) => `${s}|${g}`;

export function buildMatrix(input: {
  classes: ClassRow[];
  subjects: SubjectRow[];
  assignments: RawAssignment[];
  configs: ConfigRow[];
  teacherPool: PoolRow[];
}): MatrixPayload {
  const { classes, subjects, assignments, configs, teacherPool } = input;

  const gradeOf = new Map(classes.map((c) => [c.gradeId, c.gradeOrdinal] as const));
  const standards: Record<string, number> = {};
  for (const cfg of configs) {
    if (!cfg.gradeId) continue;
    const ord = gradeOf.get(cfg.gradeId);
    if (ord !== undefined) standards[key(cfg.subjectId, cfg.gradeId)] = cfg.periodsPerWeek;
  }

  // Ghép lớp: cùng assignmentId xuất hiện ở nhiều dòng lớp — giữ nguyên để
  // client nhận diện badge ⛓; đếm tiết về TỪNG lớp tham gia (đúng nghĩa mỗi
  // lớp đều có tiết đó trong lưới của mình).
  const cells: MatrixCell[] = assignments.map((a) => ({
    assignmentId: a.assignmentId,
    subjectId: a.subjectId,
    classId: a.classId,
    periodsPerWeek: a.periodsPerWeek,
    teacherIds: [...a.teacherIds].sort(),
  }));

  const byClass = classes.map((c) => {
    const assigned = assignments
      .filter((a) => a.classId === c.id)
      .reduce((s, a) => s + a.periodsPerWeek, 0);
    const stdKey = Object.keys(standards).find((k) =>
      k.startsWith('|') ? false : true);
    void stdKey;
    // Chuẩn của lớp = Σ chuẩn các môn theo khối của lớp
    let standard = 0;
    for (const sj of subjects) {
      standard += standards[key(sj.id, c.gradeId)] ?? 0;
    }
    return { classId: c.id, assigned, standard };
  });

  const bySubject = subjects.map((sj) => ({
    subjectId: sj.id,
    periods: assignments.filter((a) => a.subjectId === sj.id)
      .reduce((s, a) => s + a.periodsPerWeek, 0),
  }));

  return {
    classes, subjects, cells, standards, totals: { byClass, bySubject },
    teacherPool: [...teacherPool].sort((a, b) => a.assigned - b.assigned),
  };
}

/* ================= Áp ma trận (POST bulk) ================= */

export interface ApplyItem {
  classId: string;
  subjectId: string;
  /** 0 hoặc bỏ trống = XOÁ phân công của ô này */
  periodsPerWeek?: number;
  teacherIds?: string[];
}

export interface ExistingCell {
  assignmentId: string;
  subjectId: string;
  classId: string;
  periodsPerWeek: number;
  teacherIds: string[];
}

export interface ApplyOp {
  kind: 'create' | 'update_ppw' | 'update_teachers' | 'delete';
  assignmentId?: string;
  classId: string;
  subjectId: string;
  periodsPerWeek?: number;
  teacherIds?: string[];
}

export interface AppliedWarning {
  kind: 'TEACHER_NOT_QUALIFIED' | 'DUPLICATE_IN_REQUEST';
  message: string;
  refs: Record<string, unknown>;
}

/**
 * So trạng thái mong muốn của từng Ô với hiện trạng -> danh sách op tối thiểu.
 * Ô không xuất hiện trong items GIỮ NGUYÊN (client gửi 0 để xoá rõ ràng).
 */
export function planApply(
  existing: ExistingCell[],
  qualifiedTeachers: Map<string, Set<string>>, // subjectId -> set teacherId
  items: ApplyItem[],
): { ops: ApplyOp[]; warnings: AppliedWarning[] } {
  const index = new Map<string, ExistingCell>();
  for (const e of existing) index.set(`${e.classId}|${e.subjectId}`, e);

  const ops: ApplyOp[] = [];
  const warnings: AppliedWarning[] = [];
  const seenInRequest = new Set<string>();

  for (const it of items) {
    const pair = `${it.classId}|${it.subjectId}`;
    if (seenInRequest.has(pair)) {
      warnings.push({
        kind: 'DUPLICATE_IN_REQUEST',
        message: 'Một ô bị khai báo hai lần trong request — dùng lần cuối',
        refs: { classId: it.classId, subjectId: it.subjectId },
      });
    }
    seenInRequest.add(pair);

    // GV đủ chuyên môn? — chỉ cảnh báo, vẫn cho lưu (§4.3 là warning)
    for (const tid of it.teacherIds ?? []) {
      const okSet = qualifiedTeachers.get(it.subjectId);
      if (okSet && !okSet.has(tid)) {
        warnings.push({
          kind: 'TEACHER_NOT_QUALIFIED',
          message: 'Giáo viên không có môn này trong danh sách dạy được',
          refs: { classId: it.classId, subjectId: it.subjectId, teacherId: tid },
        });
      }
    }

    const cur = index.get(pair);
    const ppw = Math.max(0, it.periodsPerWeek || 0);
    const teachers = [...new Set(it.teacherIds ?? [])];

    if (ppw === 0 || teachers.length === 0) {
      if (cur) {
        ops.push({ kind: 'delete', assignmentId: cur.assignmentId, classId: it.classId, subjectId: it.subjectId });
      }
      continue;
    }

    if (!cur) {
      ops.push({ kind: 'create', classId: it.classId, subjectId: it.subjectId, periodsPerWeek: ppw, teacherIds: teachers });
      continue;
    }
    if (cur.periodsPerWeek !== ppw) {
      ops.push({ kind: 'update_ppw', assignmentId: cur.assignmentId, classId: it.classId, subjectId: it.subjectId, periodsPerWeek: ppw });
    }
    const changed = cur.teacherIds.length !== teachers.length ||
      teachers.some((t) => !cur.teacherIds.includes(t));
    if (changed) {
      ops.push({ kind: 'update_teachers', assignmentId: cur.assignmentId, classId: it.classId, subjectId: it.subjectId, teacherIds: teachers });
    }
  }

  return { ops, warnings };
}
