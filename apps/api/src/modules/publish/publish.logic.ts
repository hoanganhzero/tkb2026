/**
 * Công bố thời khoá biểu — ranh giới quyền quan trọng nhất (permissions §2.7):
 * scheduler xếp được nhưng KHÔNG tự công bố (endpoint đã chặn bằng PermissionGuard
 * 'timetable.publish' chỉ có owner/admin).
 * Logic thuần ở đây: điều kiện chặn + sinh slug trang công khai.
 */

export interface PublishableState {
  status: string;
  hardViolations: number;
}

/** Trả về lý do nếu KHÔNG công bố được, ngược lại null */
export function publishBlocker(t: PublishableState): string | null {
  if (t.status === 'published') return 'Thời khoá biểu đã ở trạng thái công bố.';
  if (t.status === 'archived') return 'Bản này đã lưu trữ — không công bố được.';
  if (t.hardViolations > 0) {
    return `Còn ${t.hardViolations} lỗi ràng buộc cứng — phải xử lý hết trước khi công bố.`;
  }
  return null;
}

export function unpublishBlocker(status: string): string | null {
  if (status !== 'published') return 'Chỉ gỡ được bản đang công bố.';
  return null;
}

export function makePublicSlug(
  schoolSlug: string,
  yearName: string,
  semesterOrdinal: number | null,
  rand4: string,
): string {
  const hk = semesterOrdinal ? `-hk${semesterOrdinal}` : '';
  return `${schoolSlug}-tkb-${yearName}${hk}-${rand4}`.toLowerCase();
}
