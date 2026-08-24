/**
 * Ánh xạ lớp qua ranh giới năm học (rollover doc §4).
 * Ba nhóm bắt buộc: khối cuối RA TRƯỜNG · giữa cấp THĂNG · đầu cấp TUYỂN MỚI.
 * Không bao giờ tự đoán thay người dùng khi tên không suy được (§4.3).
 */

export interface OldClass {
  id: string;
  name: string;
  gradeOrdinal: number;
  homeroomTeacherId?: string | null;
}

export interface ClassMapping {
  sourceId: string | null;
  /** NULL = người dùng phải điền tay (auto=false) hoặc không tạo (graduate/skip) */
  targetName: string | null;
  gradeOrdinal: number;
  action: 'promote' | 'graduate' | 'create' | 'skip';
  homeroomTeacherId: string | null;
  auto: boolean;
  note?: string;
}

export interface ClassMapOptions {
  span: { first: number; last: number };
  /** Số lớp khối đầu cấp tuyển mới + mẫu tên có ký tự # */
  intake?: { gradeOrdinal: number; count: number; namePattern: string };
  /** Các khối bị xáo trộn -> KHÔNG ánh xạ, tạo mới toàn bộ (người dùng tự đặt tên) */
  shuffleGrades?: number[];
  /** Với khối xáo trộn/tuyển mới: số lớp + mẫu tên ('11A#' -> 11A1…11A9,11A10…) */
  createCounts?: Array<{ gradeOrdinal: number; count: number; namePattern: string }>;
}

/** Suy tên lớp mới '10A1' -> '11A1'. Trả null nếu không suy được (§4.2). */
export function promoteClassName(
  name: string,
  fromOrdinal: number,
  toOrdinal: number,
): string | null {
  const m = name.trim().match(/^(\d+)\s*(.+)$/);
  if (!m) return null;
  if (Number(m[1]) !== fromOrdinal) return null;
  return `${toOrdinal}${m[2]}`;
}

function expandPattern(pattern: string, i: number): string {
  return pattern.replace(/#/g, String(i));
}

export function mapClasses(oldClasses: OldClass[], opts: ClassMapOptions): ClassMapping[] {
  const out: ClassMapping[] = [];
  const { first, last } = opts.span;

  // 1. Khối cuối cấp ra trường
  for (const c of oldClasses.filter((c) => c.gradeOrdinal === last)) {
    out.push({
      sourceId: c.id, targetName: null, gradeOrdinal: last,
      action: 'graduate', homeroomTeacherId: null, auto: true,
      note: 'Ra trường — không tạo lớp mới',
    });
  }

  // 2. Khối bị xáo trộn: đánh dấu skip (phân công không mang theo theo lớp)
  for (const c of oldClasses.filter((c) => opts.shuffleGrades?.includes(c.gradeOrdinal))) {
    out.push({
      sourceId: c.id, targetName: null, gradeOrdinal: c.gradeOrdinal,
      action: 'skip', homeroomTeacherId: null, auto: true,
      note: 'Khối xáo trộn — học sinh tản sang lớp mới, không ánh xạ 1-1',
    });
  }

  // 3. Thăng cấp các khối còn lại
  for (const c of oldClasses.filter((c) =>
    c.gradeOrdinal !== last && !opts.shuffleGrades?.includes(c.gradeOrdinal)
  )) {
    const promoted = promoteClassName(c.name, c.gradeOrdinal, c.gradeOrdinal + 1);
    out.push({
      sourceId: c.id,
      targetName: promoted,           // null -> UI bắt điền tay
      gradeOrdinal: c.gradeOrdinal + 1,
      action: 'promote',
      homeroomTeacherId: c.homeroomTeacherId ?? null,
      auto: promoted !== null,
    });
  }

  // 4. Lớp tạo mới (khối đầu cấp tuyển sinh + khối xáo trộn nếu khai counts)
  const creates = [
    ...(opts.intake ? [opts.intake] : []),
    ...(opts.createCounts ?? [])
  ];
  for (const cc of creates) {
    for (let i = 1; i <= cc.count; i++) {
      out.push({
        sourceId: null,
        targetName: expandPattern(cc.namePattern, i),
        gradeOrdinal: cc.gradeOrdinal,
        action: 'create',
        homeroomTeacherId: null,
        auto: true,
      });
    }
  }

  return out;
}
