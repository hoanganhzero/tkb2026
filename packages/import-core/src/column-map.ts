/**
 * Ánh xạ cột theo từ điển đồng nghĩa + tìm dòng tiêu đề (excel_import §3.1–3.2).
 * Luôn cho phép gán tay ở tầng UI — danh sách đồng nghĩa không bao giờ đủ.
 */
import { normalizeKey } from './normalize.ts';

export type SheetKind = 'teachers' | 'classes' | 'subjects' | 'assignments' | 'rooms';

const TEACHER_COLS: Record<string, string> = {
  hovaten: 'full_name', hoten: 'full_name', tengiaovien: 'full_name',
  giaovien: 'full_name', ten: 'full_name', hotengv: 'full_name',
  magv: 'code', ma: 'code', magiaovien: 'code', sott: 'code', stt: 'code',
  tobomon: 'department', to: 'department', tochuyenmon: 'department', bomon: 'department',
  mondayduoc: 'subjects', monday: 'subjects', chuyenmon: 'subjects',
  sotiettoida: 'max_periods', dinhmuc: 'max_periods', sotiet: 'max_periods', sotiettuan: 'max_periods',
  email: 'email', dienthoai: 'phone', sodienthoai: 'phone', sdt: 'phone', dt: 'phone',
  gioitinh: 'gender'
};

const CLASS_COLS: Record<string, string> = {
  lop: 'class_name', tenlop: 'class_name', lophoc: 'class_name',
  khoi: 'grade', khoilop: 'grade',
  siso: 'size', sohocsinh: 'size', sisohs: 'size',
  gvcn: 'homeroom', chunhiem: 'homeroom', giaovienchunhiem: 'homeroom',
  phong: 'room', phonghoc: 'room', tenphong: 'room', maphong: 'room',
  buoihoc: 'session'
};

const ASSIGNMENT_COLS: Record<string, string> = {
  lop: 'class_name', tenlop: 'class_name',
  mon: 'subject', monhoc: 'subject',
  giaovien: 'teacher', gvgiang: 'teacher', gv: 'teacher',
  sotiettuan: 'periods_per_week', tiettuan: 'periods_per_week',
  sotiet: 'periods_per_week', tiet: 'periods_per_week',
  ghichu: 'note'
};

const SUBJECT_COLS: Record<string, string> = {
  mamon: 'code', ma: 'code',
  tenmon: 'name', monhoc: 'name', ten: 'name',
  tenviettat: 'short', viettat: 'short',
  tobomon: 'department',
  canphongbomon: 'needs_room',
  khoi10: 'g10', khoi11: 'g11', khoi12: 'g12'
};

const ROOM_COLS: Record<string, string> = {
  maphong: 'code', phong: 'code',
  tenphong: 'name',
  loaiphong: 'kind',
  succhua: 'capacity',
  tang: 'floor', co_so: 'building', coso: 'building'
};

const DICTS: Record<SheetKind, Record<string, string>> = {
  teachers: TEACHER_COLS,
  classes: CLASS_COLS,
  subjects: SUBJECT_COLS,
  assignments: ASSIGNMENT_COLS,
  rooms: ROOM_COLS
};

/** Trả về tên trường đích nếu nhận diện được, ngược lại null.
 *  Hai bước: khớp chính xác trước, rồi khớp chứa (ưu tiên khoá dài nhất)
 *  để bắt "Số tiết tối đa/tuần" chứa khoá ngắn hơn "sotiettoida". */
export function matchColumn(header: string, sheet: SheetKind): string | null {
  const k = normalizeKey(header);
  if (!k) return null;
  const dict = DICTS[sheet];
  if (dict[k]) return dict[k];

  let bestKey = '', bestField: string | null = null;
  for (const [key, field] of Object.entries(dict)) {
    if (key.length < 4) continue; // khoá ngắn quá dễ dính nhầm khi contains
    if ((k.includes(key) || key.includes(k)) && key.length > bestKey.length) {
      bestKey = key; bestField = field;
    }
  }
  return bestField;
}

export interface ColumnMapping { index: number; header: string; field: string | null }

export function mapColumns(headers: unknown[], sheet: SheetKind): ColumnMapping[] {
  return headers.map((h, i) => ({
    index: i,
    header: String(h ?? ''),
    field: matchColumn(String(h ?? ''), sheet)
  }));
}

/**
 * Tìm dòng tiêu đề: quét tối đa 15 dòng đầu, chọn dòng khớp nhiều tên cột
 * nhất; yêu cầu >=2 cột khớp (§3.1). Trả -1 nếu không tìm thấy.
 */
export function findHeaderRow(rows: unknown[][], sheet: SheetKind): number {
  let best = -1, bestScore = 0;
  const scan = Math.min(rows.length, 15);
  for (let r = 0; r < scan; r++) {
    const score = rows[r].reduce<number>((acc, c) =>
      acc + (matchColumn(String(c ?? ''), sheet) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return bestScore >= 2 ? best : -1;
}

/**
 * Nhận dạng sheet Phân công dạng ma trận Lớp × Môn (§2.5):
 * ô đầu tiêu đề là "lớp" và các ô khác khớp tên môn đã khai báo.
 */
export function detectMatrixLayout(
  rows: unknown[][],
  knownSubjects: Array<{ name: string; short?: string }>,
): number {
  const subjectKeys = new Set<string>();
  for (const s of knownSubjects) {
    subjectKeys.add(normalizeKey(s.name));
    if (s.short) subjectKeys.add(normalizeKey(s.short));
  }
  const scan = Math.min(rows.length, 15);
  for (let r = 0; r < scan; r++) {
    const cells = rows[r].map((c) => String(c ?? '').trim());
    if (!cells.length) continue;
    const k0 = normalizeKey(cells[0]);
    // "Lớp", "Lớp \ Môn", "Lớp/Môn"… đều chấp nhận
    if (!(k0 === 'lop' || k0.startsWith('lop'))) continue;
    let matched = 0;
    for (let ci = 1; ci < cells.length; ci++) {
      if (subjectKeys.has(normalizeKey(cells[ci]))) matched++;
    }
    if (matched >= 2 || (matched >= 1 && matched === cells.length - 1)) return r;
  }
  return -1;
}
