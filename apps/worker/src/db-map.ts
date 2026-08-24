/**
 * Chuyển đổi hàng CSDL <-> SolverProblem — PHẦN THUẦN, test không cần Redis/DB.
 * Nguồn sự thật về allowMask: availability_slots (schema mục 6a) với
 *   preference 'busy'  -> chặn cứng (bit tắt)
 *   'avoid'            -> để cho cost-core phạt mềm S8 (không chặn ở đây)
 */
import type { SolverProblem } from '@tkb/solver-core';
import type { AssignmentInput } from '@tkb/cost-core';

export interface PeriodRow { id: string; session: 'morning' | 'afternoon' | 'evening'; dayPosition: number }
export interface AvailabilityRow {
  ownerType: 'teacher' | 'class' | 'room';
  ownerId: string;
  dayOfWeek: number;      // 1..7 ISO
  periodId: string;
  preference: 'available' | 'busy' | 'preferred' | 'avoid';
}
export interface AssignmentRow {
  id: string; subjectId: string;
  classIds: string[]; teacherIds: string[];
  difficulty?: number; maxPerDay?: number;
  session?: 'morning' | 'afternoon' | null;
}
export interface MapInput {
  activeDays: number[];
  periods: PeriodRow[];
  classes: string[];
  teachers: string[];
  subjects: string[];
  assignments: AssignmentRow[];
  /** Các tiết cần xếp — thứ tự chính là chỉ số tiết trong solver */
  lessons: Array<{ assignmentId: string }>;
  availability: AvailabilityRow[];
}

export interface MappedContext {
  classIndex: Map<string, number>;
  teacherIndex: Map<string, number>;
  subjectIndex: Map<string, number>;
  assignmentById: Map<string, AssignmentRow>;
  lessonMeta: Array<{ assignmentId: string }>;
  slotToCell: (slot: number) => { dayOfWeek: number; periodId: string };
}

function wordsFor(slots: number) { return Math.ceil(slots / 32); }
function clearBit(mask: Uint32Array, slot: number) {
  mask[slot >>> 5] &= ~(1 << (slot & 31));
}
/** Mask đầy đủ ĐÃ CẮT bit thừa — quy ước bit thấp (slot s = 1<<(s&31)).
 *  Nếu không cắt, vòng duyệt bit gặp ô "ma" index >= totalSlots. */
function trimmedFull(totalSlots: number): Uint32Array {
  const w = wordsFor(totalSlots);
  const m = new Uint32Array(w).fill(0xFFFFFFFF);
  const usedInLast = totalSlots - (w - 1) * 32;
  if (usedInLast < 32) {
    m[w - 1] = usedInLast <= 0 ? 0 : ((1 << usedInLast) - 1) >>> 0;
  }
  return m;
}

export function mapRowsToProblem(input: MapInput): { problem: SolverProblem; ctx: MappedContext } {
  const P = input.periods.length;
  const totalSlots = input.activeDays.length * P;
  const FULL = trimmedFull(totalSlots);

  const sortedPeriods = [...input.periods].sort((a, b) => a.dayPosition - b.dayPosition);
  const posRank = new Map<string, number>();
  sortedPeriods.forEach((p, i) => posRank.set(p.id, i));

  const classIndex = new Map(input.classes.map((id, i) => [id, i] as const));
  const teacherIndex = new Map(input.teachers.map((id, i) => [id, i] as const));
  const subjectIndex = new Map(input.subjects.map((id, i) => [id, i] as const));

  // Mặt nạ bận theo chủ thể
  const busy = new Map<string, Uint32Array>();
  const maskFor = (type: string, id: string): Uint32Array => {
    const key = type + ':' + id;
    let m = busy.get(key);
    if (!m) { m = Uint32Array.from(FULL); busy.set(key, m); }
    return m;
  };
  for (const av of input.availability) {
    if (av.preference !== 'busy') continue;
    const rank = posRank.get(av.periodId);
    if (rank === undefined) continue;
    const di = input.activeDays.indexOf(av.dayOfWeek);
    if (di < 0) continue;
    clearBit(maskFor(av.ownerType, av.ownerId), di * P + rank);
  }

  const assignments: AssignmentInput[] = [];
  const allowMasks: Uint32Array[] = [];
  for (const a of input.assignments) {
    assignments.push({
      classes: a.classIds.map((id) => classIndex.get(id)!).filter((x) => x !== undefined),
      teachers: a.teacherIds.map((id) => teacherIndex.get(id)!).filter((x) => x !== undefined),
      subject: subjectIndex.get(a.subjectId) ?? 0,
      difficulty: a.difficulty ?? 3,
      maxPerDay: a.maxPerDay ?? 1
    });
    const m = Uint32Array.from(FULL);
    for (const cid of a.classIds) andMask(m, maskFor('class', cid));
    for (const tid of a.teacherIds) andMask(m, maskFor('teacher', tid));
    if (a.session) {
      // Chỉ nhận tiết thuộc buổi được chỉ định
      for (const p of input.periods) {
        if (p.session !== a.session) {
          const rank = posRank.get(p.id)!;
          for (let d = 0; d < input.activeDays.length; d++) clearBit(m, d * P + rank);
        }
      }
    }
    allowMasks.push(m);
  }

  const lessonAssignment = input.lessons.map((l) => {
    const idx = input.assignments.findIndex((a) => a.id === l.assignmentId);
    return idx < 0 ? 0 : idx;
  });

  const problem: SolverProblem = {
    days: input.activeDays.length,
    periodsPerDay: P,
    numClasses: input.classes.length,
    numTeachers: Math.max(1, input.teachers.length),
    numSubjects: Math.max(1, input.subjects.length),
    assignments,
    lessonAssignment,
    allowMasks
  };

  const ctx: MappedContext = {
    classIndex, teacherIndex, subjectIndex,
    assignmentById: new Map(input.assignments.map((a) => [a.id, a] as const)),
    lessonMeta: input.lessons,
    slotToCell: (slot: number) => {
      const di = Math.floor(slot / P), rank = slot % P;
      return { dayOfWeek: input.activeDays[di], periodId: sortedPeriods[rank].id };
    }
  };

  return { problem, ctx };
}

function andMask(target: Uint32Array, other: Uint32Array) {
  for (let i = 0; i < target.length; i++) target[i] &= other[i];
}

/* ---------- kết quả -> bản ghi ghi DB ---------- */

export interface LessonWrite {
  assignmentId: string;
  dayOfWeek: number;
  periodId: string;
  classIds: string[];
  teacherIds: string[];
}

/** Đổi mảng slots của solver thành danh sách bản ghi lesson để INSERT. */
export function resultToWrites(
  slots: Int32Array,
  mapped: MappedContext,
): LessonWrite[] {
  const writes: LessonWrite[] = [];
  for (let li = 0; li < slots.length; li++) {
    const s = slots[li];
    if (s < 0) continue;
    const meta = mapped.lessonMeta[li];
    const a = mapped.assignmentById.get(meta.assignmentId);
    if (!a) continue;
    const cell = mapped.slotToCell(s);
    writes.push({
      assignmentId: a.id,
      dayOfWeek: cell.dayOfWeek,
      periodId: cell.periodId,
      classIds: a.classIds,
      teacherIds: a.teacherIds
    });
  }
  return writes;
}
