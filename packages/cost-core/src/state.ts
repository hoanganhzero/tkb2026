import type { ProblemInput } from './types.ts';
import { UNPLACED_PENALTY, W } from './types.ts';

function hasBit(mask: Uint32Array | undefined, slot: number): boolean {
  if (!mask) return false;
  const word = mask[slot >>> 5];
  return word !== undefined && (word & (1 << (slot & 31))) !== 0;
}

/**
 * Trạng thái lời giải + hàm chi phí đánh giá TĂNG DẦN.
 *
 * Ràng buộc cứng nằm ở định nghĩa phép biến đổi: canPlace/move chỉ đi tới
 * trạng thái không trùng lớp, trùng GV (solver spec mục 1). Chi phí ở đây
 * CHỈ gồm ràng buộc mềm.
 *
 * Đơn vị chi phí, mỗi đơn vị recompute O(P):
 *   ucd(class, day)   S1 gap · S4 trùng môn · S5 môn khó cuối buổi · S8 ô hạn chế
 *   utd(teacher, day) S2 gap · S6 vượt định mức ngày
 *   ucw(class)        S7 cân bằng tải giữa các ngày
 *   utw(teacher)      S3 số ngày đến trường
 *   ucs(class, subj)  S9 rải môn đều trong tuần
 *   pair(min(l,p))    S12 tiết đôi bị tách
 * total = Σ đơn vị + UNPLACED_PENALTY × số tiết chưa đặt.
 */
export class TimetableState {
  readonly problem: ProblemInput;
  readonly days: number;
  readonly periodsPerDay: number;
  readonly slots: Int32Array;
  readonly numLessons: number;

  private readonly clsOcc: Int32Array;
  private readonly teaOcc: Int32Array;
  private readonly ucd: Float64Array;
  private readonly utd: Float64Array;
  private readonly ucw: Float64Array;
  private readonly utw: Float64Array;
  private readonly ucs: Float64Array;

  private readonly aids: Int32Array;
  private readonly pairs: Int32Array;
  private readonly csLists = new Map<number, number[]>(); // key c*numSubjects+s

  total = 0;

  constructor(problem: ProblemInput) {
    this.problem = problem;
    this.days = problem.days;
    this.periodsPerDay = problem.periodsPerDay;
    this.numLessons = problem.lessonAssignment.length;
    this.slots = new Int32Array(this.numLessons).fill(-1);
    this.aids = Int32Array.from(problem.lessonAssignment);
    this.pairs = Int32Array.from(problem.lessonPair ?? new Int32Array(this.numLessons).fill(-1));

    this.clsOcc = new Int32Array(problem.numClasses * this.S()).fill(-1);
    this.teaOcc = new Int32Array(problem.numTeachers * this.S()).fill(-1);

    this.ucd = new Float64Array(problem.numClasses * this.days);
    this.utd = new Float64Array(problem.numTeachers * this.days);
    this.ucw = new Float64Array(problem.numClasses);
    this.utw = new Float64Array(problem.numTeachers);
    this.ucs = new Float64Array(problem.numClasses * problem.numSubjects);

    for (let li = 0; li < this.numLessons; li++) {
      const a = problem.assignments[this.aids[li]];
      const key = a.classes[0] * problem.numSubjects + a.subject;
      let list = this.csLists.get(key);
      if (!list) { list = []; this.csLists.set(key, list); }
      list.push(li);
    }
  }

  S(): number { return this.days * this.periodsPerDay; }

  private lessonsOf(li: number) {
    return this.problem.assignments[this.aids[li]];
  }

  /* ---------- occupancy ---------- */

  place(li: number, slot: number): void {
    const L = this.lessonsOf(li);
    this.slots[li] = slot;
    for (const c of L.classes) this.clsOcc[c * this.S() + slot] = li;
    for (const t of L.teachers) this.teaOcc[t * this.S() + slot] = li;
  }

  unplace(li: number): void {
    const s = this.slots[li];
    if (s < 0) return;
    const L = this.lessonsOf(li);
    for (const c of L.classes) this.clsOcc[c * this.S() + s] = -1;
    for (const t of L.teachers) this.teaOcc[t * this.S() + s] = -1;
    this.slots[li] = -1;
  }

  /** Ràng buộc cứng: chỉ kiểm tra chiếm dụng. Lịch bận GV/lớp là allowMask
   *  tầng trên (đã AND vào miền ứng viên trước khi gọi). */
  canPlace(li: number, slot: number): boolean {
    if (slot < 0 || slot >= this.S()) return false;
    const L = this.lessonsOf(li);
    for (const c of L.classes) if (this.clsOcc[c * this.S() + slot] >= 0) return false;
    for (const t of L.teachers) if (this.teaOcc[t * this.S() + slot] >= 0) return false;
    const p = this.pairs[li];
    if (p >= 0 && slot % this.periodsPerDay === this.periodsPerDay - 1) return false;
    return true;
  }

  unplacedCount(): number {
    let n = 0;
    for (let i = 0; i < this.numLessons; i++) if (this.slots[i] < 0) n++;
    return n;
  }

  /* ---------- tra cứu công khai (cho explain.ts / đèn giao thông client) ---------- */

  lessonAtClass(c: number, slot: number): number { return this.clsOcc[c * this.S() + slot]; }
  lessonAtTeacher(t: number, slot: number): number { return this.teaOcc[t * this.S() + slot]; }

  teacherDayCount(t: number, day: number): number {
    let n = 0;
    for (let p = 0; p < this.periodsPerDay; p++)
      if (this.teaOcc[t * this.S() + day * this.periodsPerDay + p] >= 0) n++;
    return n;
  }

  classSameSubjectDay(c: number, subject: number, day: number): number {
    let n = 0;
    for (let p = 0; p < this.periodsPerDay; p++) {
      const li = this.clsOcc[c * this.S() + day * this.periodsPerDay + p];
      if (li >= 0 && this.problem.assignments[this.aids[li]].subject === subject) n++;
    }
    return n;
  }

  /* ---------- đơn vị chi phí ---------- */

  /** Tách thành phần để explain() quy kết đúng mã ràng buộc. */
  unitCDParts(c: number, d: number): { gap: number; s4: number; s5: number; s8: number } {
    const P = this.periodsPerDay;
    let first = -1, last = -1, count = 0;
    let gap = 0, s4 = 0, s5 = 0, s8 = 0;
    const perAid = new Map<number, number>();
    for (let p = 0; p < P; p++) {
      const li = this.clsOcc[c * this.S() + d * P + p];
      if (li < 0) continue;
      if (first < 0) first = p;
      last = p; count++;
      const aid = this.aids[li], a = this.problem.assignments[aid];
      perAid.set(aid, (perAid.get(aid) ?? 0) + 1);
      if (a.difficulty >= 4) s5 += W.S5_DIFFICULT_LATE * Math.max(0, p - 2);
      if (hasBit(a.avoidMask, d * P + p)) s8 += W.S8_SLOT_PREFERENCE;
    }
    if (count > 1) gap = W.S1_CLASS_GAP * ((last - first + 1) - count);
    for (const [aid, cnt] of perAid) {
      const max = this.problem.assignments[aid].maxPerDay ?? 1;
      if (cnt > max) s4 += W.S4_SAME_SUBJECT_DAY * (cnt - max);
    }
    return { gap, s4, s5, s8 };
  }

  unitCD(c: number, d: number): number {
    const v = this.unitCDParts(c, d);
    return v.gap + v.s4 + v.s5 + v.s8;
  }

  unitTDParts(t: number, d: number): { gap: number; overload: number } {
    const P = this.periodsPerDay;
    let first = -1, last = -1, count = 0;
    for (let p = 0; p < P; p++) {
      if (this.teaOcc[t * this.S() + d * P + p] >= 0) { if (first < 0) first = p; last = p; count++; }
    }
    if (count === 0) return { gap: 0, overload: 0 };
    const gap = W.S2_TEACHER_GAP * ((last - first + 1) - count);
    const maxPd = this.problem.teacherMaxPerDay?.[t] ?? 6;
    const overload = count > maxPd ? W.S6_TEACHER_OVERLOAD * (count - maxPd) : 0;
    return { gap, overload };
  }

  unitTD(t: number, d: number): number {
    const v = this.unitTDParts(t, d);
    return v.gap + v.overload;
  }

  /** S7 v1: phạt phần tải vượt mức chia đều làm tròn lên. TODO đổi sang độ
   *  lệch chuẩn đúng nghĩa khi hiệu chỉnh trọng số trên dữ liệu thật. */
  unitCW(c: number): number {
    const counts = new Array<number>(this.days).fill(0);
    let totalCnt = 0;
    for (let i = 0; i < this.S(); i++) {
      if (this.clsOcc[c * this.S() + i] >= 0) { counts[(i / this.periodsPerDay) | 0]++; totalCnt++; }
    }
    const fair = Math.ceil(totalCnt / this.days);
    let excess = 0;
    for (const cnt of counts) if (cnt > fair) excess += cnt - fair;
    return W.S7_CLASS_LOAD_BALANCE * excess;
  }

  unitTW(t: number): number {
    const counts = new Array<number>(this.days).fill(0);
    let totalCnt = 0;
    for (let i = 0; i < this.S(); i++) {
      if (this.teaOcc[t * this.S() + i] >= 0) { counts[(i / this.periodsPerDay) | 0]++; totalCnt++; }
    }
    let used = 0;
    for (const cnt of counts) if (cnt > 0) used++;
    const maxPd = this.problem.teacherMaxPerDay?.[t] ?? 6;
    const fair = Math.max(1, Math.ceil(totalCnt / maxPd));
    return W.S3_TEACHER_DAYS * Math.max(0, used - fair);
  }

  unitCS(key: number): number {
    const list = this.csLists.get(key);
    if (!list || list.length < 2) return 0;
    const slots = list.map((li) => this.slots[li]).filter((s) => s >= 0).sort((a, b) => a - b);
    const n = slots.length;
    if (n < 2) return 0;
    const minGapDays = Math.floor(this.days / n);
    let pen = 0;
    for (let k = 1; k < n; k++) {
      const dayA = (slots[k - 1] / this.periodsPerDay) | 0;
      const dayB = (slots[k] / this.periodsPerDay) | 0;
      if (dayB - dayA < minGapDays) pen += W.S9_SUBJECT_SPREAD;
    }
    return pen;
  }

  /** Chỉ có ý nghĩa khi truyền vào CHỈ SỐ NHỎ HƠN của cặp tiết đôi. */
  pairPenalty(smaller: number): number {
    const p = this.pairs[smaller];
    if (p < 0 || p < smaller) return 0;
    const a = this.slots[smaller], b = this.slots[p];
    if (a < 0 || b < 0) return 0;
    const adjacent = b === a + 1 &&
      ((a / this.periodsPerDay) | 0) === ((b / this.periodsPerDay) | 0);
    return adjacent ? 0 : W.S12_DOUBLE_SPLIT;
  }

  private pairKey(li: number): number {
    const p = this.pairs[li];
    return p >= 0 ? Math.min(li, p) : -1;
  }

  recomputeAll(): void {
    const pr = this.problem;
    let sum = 0;
    for (let c = 0; c < pr.numClasses; c++)
      for (let d = 0; d < this.days; d++) {
        const v = this.unitCD(c, d); this.ucd[c * this.days + d] = v; sum += v;
      }
    for (let t = 0; t < pr.numTeachers; t++)
      for (let d = 0; d < this.days; d++) {
        const v = this.unitTD(t, d); this.utd[t * this.days + d] = v; sum += v;
      }
    for (let c = 0; c < pr.numClasses; c++) { this.ucw[c] = this.unitCW(c); sum += this.ucw[c]; }
    for (let t = 0; t < pr.numTeachers; t++) { this.utw[t] = this.unitTW(t); sum += this.utw[t]; }
    for (const key of this.csLists.keys()) { this.ucs[key] = this.unitCS(key); sum += this.ucs[key]; }
    for (let li = 0; li < this.numLessons; li++) {
      const pen = this.pairPenalty(li);
      if (pen > 0) sum += pen; // pairPenalty chỉ khác 0 khi li là phần tử nhỏ hơn
    }
    this.total = sum + this.unplacedCount() * UNPLACED_PENALTY;
  }

  /* ---------- di chuyển tăng dần ---------- */

  move(li: number, toSlot: number): void {
    const from = this.slots[li];
    if (from === toSlot) return;
    const pr = this.problem;
    const a = pr.assignments[this.aids[li]];

    const cdKeys = new Set<number>(), tdKeys = new Set<number>();
    const cwKeys = new Set<number>(a.classes);
    const twKeys = new Set<number>(a.teachers);
    const csKeys = new Set<number>();
    for (const c of a.classes) csKeys.add(c * pr.numSubjects + a.subject);

    const collectDays = (slot: number) => {
      if (slot < 0) return;
      const d = (slot / this.periodsPerDay) | 0;
      for (const c of a.classes) cdKeys.add(c * this.days + d);
      for (const t of a.teachers) tdKeys.add(t * this.days + d);
    };
    collectDays(from); collectDays(toSlot);

    let before = 0;
    for (const k of cdKeys) before += this.ucd[k];
    for (const k of tdKeys) before += this.utd[k];
    for (const k of cwKeys) before += this.ucw[k];
    for (const k of twKeys) before += this.utw[k];
    for (const k of csKeys) before += this.ucs[k];
    const pk = this.pairKey(li);
    if (pk >= 0) before += this.pairPenalty(pk);
    const unplacedBefore = this.unplacedCount();

    this.unplace(li);
    if (toSlot >= 0) this.place(li, toSlot);

    let after = 0;
    for (const k of cdKeys) {
      const v = this.unitCD((k / this.days) | 0, k % this.days);
      this.ucd[k] = v; after += v;
    }
    for (const k of tdKeys) {
      const v = this.unitTD((k / this.days) | 0, k % this.days);
      this.utd[k] = v; after += v;
    }
    for (const k of cwKeys) { this.ucw[k] = this.unitCW(k); after += this.ucw[k]; }
    for (const k of twKeys) { this.utw[k] = this.unitTW(k); after += this.utw[k]; }
    for (const k of csKeys) { this.ucs[k] = this.unitCS(k); after += this.ucs[k]; }
    if (pk >= 0) after += this.pairPenalty(pk);
    const unplacedAfter = this.unplacedCount();

    this.total += after - before + (unplacedAfter - unplacedBefore) * UNPLACED_PENALTY;
  }

  /** Xem trước chênh lệch mà không thay đổi trạng thái */
  deltaMove(li: number, toSlot: number): number {
    const from = this.slots[li];
    const before = this.total;
    this.move(li, toSlot);
    const delta = this.total - before;
    this.move(li, from);
    return delta;
  }
}
