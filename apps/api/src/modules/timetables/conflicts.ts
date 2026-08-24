/**
 * Quét xung đột TKB đã lưu — tkb_api_spec.md §2 (GET conflicts) +
 * bảng timetable_conflicts làm cache kết quả cho màn hình Kiểm tra.
 *
 * Trùng GV/lớp/phòng KHÔNG thể tồn tại trong lessons (unique index chặn ở
 * tầng CSDL) — thứ quét được thực sự là:
 *   missing_periods : phân công chưa đủ số tiết (chưa xếp xong)
 *   excess_periods  : vượt số tiết cấu hình (lỗi nhập)
 *   constraint_violation : tiết đặt vào ô GV/lớp khai báo BẬN (hard)
 */

export type ConflictKind =
  | 'missing_periods' | 'excess_periods' | 'constraint_violation';
export type Severity = 'hard' | 'soft';

export interface ConflictOut {
  kind: ConflictKind;
  severity: Severity;
  message: string;
  refs: Record<string, unknown>;
}

export interface AssignmentPlaced {
  assignmentId: string;
  classId: string;
  subjectShort: string;
  className: string;
  periodsPerWeek: number;
  placed: number;
}

export interface BusyViolation {
  lessonId: string;
  axis: 'teacher' | 'class';
  ownerId: string;
  ownerName?: string;
  dayOfWeek: number;
  periodLabel: string;
  subjectShort?: string;
}

const DOW_NAMES = ['', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

export function scanConflicts(input: {
  assignments: AssignmentPlaced[];
  busyViolations: BusyViolation[];
  /** Tổng ô khung: số tiết khung × số ngày học */
  frameSlots: number;
}): ConflictOut[] {
  const out: ConflictOut[] = [];

  for (const a of input.assignments) {
    const ref = {
      assignmentId: a.assignmentId, classId: a.classId,
      subjectId: a.subjectShort,
    };
    if (a.placed < a.periodsPerWeek) {
      out.push({
        kind: 'missing_periods', severity: 'soft',
        message: `${a.className}: môn ${a.subjectShort} còn thiếu ${a.periodsPerWeek - a.placed}/${a.periodsPerWeek} tiết chưa xếp`,
        refs: { ...ref, placed: a.placed, required: a.periodsPerWeek },
      });
    } else if (a.placed > a.periodsPerWeek) {
      out.push({
        kind: 'excess_periods',
        severity: input.frameSlots > 0 && a.placed > input.frameSlots ? 'hard' : 'soft',
        message: `${a.className}: môn ${a.subjectShort} được xếp ${a.placed} tiết, vượt cấu hình ${a.periodsPerWeek}`,
        refs: { ...ref, placed: a.placed, required: a.periodsPerWeek },
      });
    }
  }

  for (const v of input.busyViolations) {
    const who = v.axis === 'teacher'
      ? (v.ownerName ?? 'giáo viên')
      : 'lớp';
    out.push({
      kind: 'constraint_violation', severity: 'hard',
      message: `${DOW_NAMES[v.dayOfWeek] ?? '?'} ${v.periodLabel}: ${who} ${v.ownerName ?? v.ownerId} khai báo bận nhưng đang có tiết${v.subjectShort ? ` (${v.subjectShort})` : ''}`,
      refs: { lessonId: v.lessonId, axis: v.axis, ownerId: v.ownerId,
              dayOfWeek: v.dayOfWeek, periodLabel: v.periodLabel },
    });
  }

  // Ổn định hiển thị: hard trước, rồi theo loại
  return out.sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'hard' ? -1 : 1) ||
    a.kind.localeCompare(b.kind));
}
