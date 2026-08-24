/**
 * Registry + validators cho CRUD danh mục — PHẦN THUẦN (test không cần DB).
 *
 * Quy tắc an toàn số 1: body KHÔNG BAO GIỜ được chứa school_id / school_year_id /
 * id — ba giá trị này chỉ đến từ ngữ cảnh (X-School-Id qua RLS), path (:yid), và
 * đường dẫn URL. pickColumns() lọc trắng giúp service không thể quên.
 */

export interface ResourceDef {
  table: string;
  /** Các cột cho phép client ghi — snake_case đúng DB */
  columns: readonly string[];
  required: readonly string[];
  enums?: Record<string, readonly string[]>;
  ints?: readonly string[];
}

const SESSIONS = ['morning', 'afternoon', 'evening'] as const;

export const CATALOG: Record<string, ResourceDef> = {
  grades: {
    table: 'grades',
    columns: ['name', 'ordinal'],
    required: ['name'],
    ints: ['ordinal']
  },
  departments: {
    table: 'departments',
    columns: ['name', 'head_teacher_id'],
    required: ['name']
  },
  subjects: {
    table: 'subjects',
    columns: ['code', 'name', 'short_name', 'color', 'difficulty',
              'needs_special_room', 'prefer_double_period', 'department_id', 'sort_order'],
    required: ['code', 'name'],
    ints: ['difficulty', 'sort_order']
  },
  rooms: {
    table: 'rooms',
    columns: ['code', 'name', 'kind', 'capacity', 'building', 'floor'],
    required: ['code', 'name'],
    enums: { kind: ['standard', 'lab', 'computer', 'gym', 'art', 'music', 'hall', 'other'] },
    ints: ['capacity', 'floor']
  },
  teachers: {
    table: 'teachers',
    columns: ['code', 'full_name', 'short_name', 'gender', 'email', 'phone',
              'max_periods_per_week', 'max_periods_per_day', 'max_days_per_week',
              'department_id'],
    required: ['code', 'full_name'],
    ints: ['max_periods_per_week', 'max_periods_per_day', 'max_days_per_week']
  },
  classes: {
    table: 'classes',
    columns: ['name', 'grade_id', 'homeroom_teacher_id', 'home_room_id', 'size',
              'main_session', 'has_second_session', 'max_periods_per_day', 'sort_order'],
    required: ['name', 'grade_id'],
    enums: { main_session: SESSIONS },
    ints: ['size', 'max_periods_per_day', 'sort_order']
  }
};

/** UUID v4-ish — đủ để chặn rác trước khi đụng DB */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INT_FIELDS_ALWAYS = new Set(['ordinal', 'difficulty']);

export interface PayloadIssue {
  field: string;
  message: string;
}

/** Chỉ giữ cột trong whitelist và loại undefined. Body lạ bị bỏ im lặng. */
export function pickColumns(def: ResourceDef, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of def.columns) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

function coerceInt(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return undefined;
}

/**
 * Kiểm tra payload. create=true bắt buộc các trường required; patch=false bỏ qua.
 * Coerce số dạng chuỗi tại chỗ (Excel người dùng hay dán "42").
 */
export function validatePayload(
  def: ResourceDef,
  body: Record<string, unknown>,
  opts: { create: boolean },
): PayloadIssue[] {
  const issues: PayloadIssue[] = [];

  if (opts.create) {
    for (const req of def.required) {
      const v = body[req];
      if (v === undefined || v === null || String(v).trim() === '') {
        issues.push({ field: req, message: `Thiếu trường bắt buộc "${req}"` });
      }
    }
  }

  for (const col of def.columns) {
    let v = body[col];
    if (v === undefined || v === null) continue;

    if (def.enums?.[col]) {
      const allowed = def.enums[col];
      if (!allowed.includes(String(v))) {
        issues.push({ field: col, message: `"${String(v)}" không hợp lệ cho ${col} (chọn trong: ${allowed.join(', ')})` });
        continue;
      }
      continue;
    }

    if (def.ints?.includes(col)) {
      const n = coerceInt(v);
      if (n === undefined && String(v).trim() !== '') {
        issues.push({ field: col, message: `${col} phải là số nguyên` });
        continue;
      }
      if (n !== undefined) (body as any)[col] = n;
      v = n;
      if (INT_FIELDS_ALWAYS.has(col) && n !== undefined && (n < 1 || n > 12)) {
        // ordinal/difficulty kiểu nhỏ — difficulty có range riêng bên dưới
      }
    }

    if (col === 'difficulty') {
      const n = typeof v === 'number' ? v : coerceInt(v);
      if (n === undefined || n < 1 || n > 5) {
        issues.push({ field: col, message: 'difficulty phải trong khoảng 1–5' });
      }
    }

    if ((col.endsWith('_id')) && typeof v === 'string' && !UUID_RE.test(v)) {
      issues.push({ field: col, message: `${col} phải là uuid hợp lệ` });
    }

    if (col === 'email' && typeof v === 'string' && v.trim() !== ''
        && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
      issues.push({ field: col, message: 'Email không đúng định dạng' });
    }
  }

  return issues;
}

/** Bulk item: {op, id?, data} — validate từng cái, trả lỗi kèm index */
export function validateBulkItems(
  def: ResourceDef,
  items: Array<{ op?: string; id?: string; data?: Record<string, unknown> }>,
): Array<{ index: number; issues: PayloadIssue[] }> {
  const errors: Array<{ index: number; issues: PayloadIssue[] }> = [];
  items.forEach((item, index) => {
    const op = item.op ?? 'create';
    if (!['create', 'update'].includes(op)) {
      errors.push({ index, issues: [{ field: 'op', message: `op "${op}" không hỗ trợ (create|update)` }] });
      return;
    }
    if (!item.data || typeof item.data !== 'object') {
      errors.push({ index, issues: [{ field: 'data', message: 'Thiếu data' }] });
      return;
    }
    if (op === 'update' && !item.id) {
      errors.push({ index, issues: [{ field: 'id', message: 'update cần id' }] });
      return;
    }
    const issues = validatePayload(def, item.data, { create: op === 'create' });
    if (issues.length) errors.push({ index, issues });
  });
  return errors;
}

/* ================= Grade configs & teacher subjects ================= */

export function validateGradeConfigs(payload: unknown):
  { ok: true; rows: Array<{ gradeOrdinal: number; periodsPerWeek: number }> } |
  { ok: false; issues: PayloadIssue[] } {
  if (!Array.isArray(payload)) return { ok: false, issues: [{ field: 'root', message: 'Cần mảng [{gradeId|gradeOrdinal, periodsPerWeek}]' }] };
  const issues: PayloadIssue[] = [];
  const rows: Array<{ gradeOrdinal: number; periodsPerWeek: number }> = [];
  payload.forEach((item: any, i: number) => {
    const ppw = coerceInt(item?.periodsPerWeek);
    const ord = coerceInt(item?.gradeOrdinal);
    if (ord === undefined || ord < 1 || ord > 12) {
      issues.push({ field: `[${i}].gradeOrdinal`, message: 'gradeOrdinal phải là số 1..12' });
    } else if (ppw === undefined || ppw < 0 || ppw > 20) {
      issues.push({ field: `[${i}].periodsPerWeek`, message: 'periodsPerWeek phải là số 0..20' });
    } else {
      rows.push({ gradeOrdinal: ord, periodsPerWeek: ppw });
    }
  });
  return issues.length ? { ok: false, issues } : { ok: true, rows };
}

export function validateTeacherSubjects(payload: unknown):
  { ok: true; subjectIds: string[] } | { ok: false; issues: PayloadIssue[] } {
  if (!Array.isArray(payload)) return { ok: false, issues: [{ field: 'root', message: 'Cần mảng subjectId (uuid)' }] };
  const issues: PayloadIssue[] = [];
  const ids: string[] = [];
  payload.forEach((x: any, i: number) => {
    if (typeof x === 'string' && UUID_RE.test(x)) ids.push(x);
    else issues.push({ field: `[${i}]`, message: 'Phải là uuid môn học' });
  });
  return issues.length ? { ok: false, issues } : { ok: true, subjectIds: [...new Set(ids)] };
}
