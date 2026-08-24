/**
 * Kiểu dữ liệu dùng chung. Chỉ dùng cú pháp TS "erasable" để chạy trực tiếp
 * bằng node (>=22) không cần biên dịch — trình duyệt tiêu thụ qua Vite alias.
 */

export interface AssignmentInput {
  /** Các lớp tham gia (ghép lớp -> nhiều phần tử) */
  classes: readonly number[];
  /** Các giáo viên đứng lớp */
  teachers: readonly number[];
  subject: number;
  /** 1..5 — môn khó được ưu tiên tiết đầu (S5) */
  difficulty: number;
  /** Số tiết cùng môn tối đa/ngày, mặc định 1 (S4) */
  maxPerDay?: number;
  /** Bitmask W word: ô ưu tiên xếp — bỏ trống bị phạt S8 */
  preferMask?: Uint32Array;
  /** Bitmask W word: ô hạn chế xếp — sử dụng bị phạt S8 */
  avoidMask?: Uint32Array;
}

export interface ProblemInput {
  days: number;
  periodsPerDay: number;
  numClasses: number;
  numTeachers: number;
  numSubjects: number;
  assignments: readonly AssignmentInput[];
  /** aid cho từng tiết học, độ dài = số tiết */
  lessonAssignment: readonly number[];
  /** pairId trỏ lẫn nhau cho tiết đôi, -1 nếu đơn (S12). Mặc định -1 */
  lessonPair?: readonly number[];
  /** Định mức tiết/ngày của từng GV, mặc định 6 (S6) */
  teacherMaxPerDay?: readonly number[];
}

/** Trọng số mặc định — KHỚP 1:1 với tkb_solver_design.md mục 6.1.
 *  Người dùng chỉnh qua constraints.weight; lớp cấu hình ghi đè bản này. */
export const W = {
  S1_CLASS_GAP: 30,
  S2_TEACHER_GAP: 20,
  S3_TEACHER_DAYS: 15,
  S4_SAME_SUBJECT_DAY: 25,
  S5_DIFFICULT_LATE: 8,
  S6_TEACHER_OVERLOAD: 40,
  S7_CLASS_LOAD_BALANCE: 10,
  S8_SLOT_PREFERENCE: 12,
  S9_SUBJECT_SPREAD: 18,
  S12_DOUBLE_SPLIT: 35
} as const;

/** Tiết chưa đặt — phạt tuyệt đối, đảm bảo mọi lời giải trung gian ưu tiên lấp kín */
export const UNPLACED_PENALTY = 500;

export type ConstraintCode =
  | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
  | 'S6' | 'S7' | 'S8' | 'S9' | 'S12';

export interface Reason {
  code: ConstraintCode;
  text: string;
  penalty: number;
}

export interface MoveExplanation {
  delta: number;
  reasons: Reason[];
}

/** Resolver tên hiển thị — client/API truyền vào để explain() sinh tiếng Việt */
export interface NameResolver {
  className(c: number): string;
  teacherName(t: number): string;
  subjectName(s: number): string;
  dayName(d: number): string;
}
