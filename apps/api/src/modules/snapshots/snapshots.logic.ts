/**
 * Snapshot TKB — payload JSON chứa lessons + children để khôi phục nguyên trạng
 * (solver spec §12.3 ghi snapshot trước khi xoá; UI có nút Khôi phục).
 * Lesson được chèn lại GIỮ NGUYÊN id cũ — id chỉ tồn tại trong timetable này
 * nên không va chạm, và children nối lại không cần ánh xạ.
 */

export interface SnapshotLessonRow {
  id: string;
  assignment_id: string;
  subject_id: string;
  day_of_week: number;
  period_id: string;
  room_id: string | null;
  is_pinned: boolean;
  double_group_id: string | null;
}
export interface SnapshotChildPair { lesson_id: string; other_id: string }

export const SNAPSHOT_VERSION = 1;

export interface SnapshotPayload {
  v: number;
  lessons: SnapshotLessonRow[];
  classes: SnapshotChildPair[];
  teachers: SnapshotChildPair[];
}

export function buildSnapshotPayload(
  lessons: SnapshotLessonRow[],
  classes: SnapshotChildPair[],
  teachers: SnapshotChildPair[],
): SnapshotPayload {
  return { v: SNAPSHOT_VERSION, lessons, classes, teachers };
}

/** Kiểm tra payload trước khi khôi phục — version lạ từ chối rõ ràng */
export function validateSnapshotPayload(p: unknown):
  { ok: true; payload: SnapshotPayload } | { ok: false; message: string } {
  const anyP = p as SnapshotPayload;
  if (!anyP || typeof anyP !== 'object') return { ok: false, message: 'Payload không đúng khuôn dạng' };
  if (anyP.v !== SNAPSHOT_VERSION) return { ok: false, message: `Phiên bản snapshot ${anyP.v} không hỗ trợ` };
  if (!Array.isArray(anyP.lessons)) return { ok: false, message: 'Thiếu danh sách tiết' };
  if (!Array.isArray(anyP.classes) || !Array.isArray(anyP.teachers)) {
    return { ok: false, message: 'Thiếu danh sách lớp/GV của tiết' };
  }
  for (const l of anyP.lessons) {
    if (!l.id || !l.assignment_id || !l.period_id) {
      return { ok: false, message: 'Một dòng tiết thiếu id/assignment/period' };
    }
  }
  return { ok: true, payload: anyP };
}
