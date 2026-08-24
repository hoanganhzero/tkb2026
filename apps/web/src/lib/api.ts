/** Client API + kiểu dữ liệu khớp khuôn dạng từ điển/mảng-cột (api spec §3.2). */

export interface DictPeriod {
  id: string; session: string; ordinal: number; name: string;
  start: string | null; end: string | null; day_position: number;
}
export interface GridDict {
  days: number[];
  periods: DictPeriod[];
  classes: Array<{ id: string; name: string; gradeId?: string; roomId?: string }>;
  teachers: Array<{ id: string; name: string; short?: string }>;
  subjects: Array<{ id: string; short: string; name: string; color: number }>;
  rooms: Array<{ id: string; code: string }>;
  palette: string[];
}
export interface GridPayload {
  timetable: { id: string; name: string; status: string; version: number; softScore: number | null; hardViolations: number };
  dict: GridDict;
  lessons: {
    count: number;
    id: string[]; slot: number[]; subject: number[];
    class: number[]; teacher: number[]; room: number[]; flags: number[];
  };
}

export interface MoveResult {
  lesson: { id: string };
  timetable: { version: number };
  delta: null | { violations?: Array<{ message: string }> };
}

export function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('tkb.access');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchGrid(timetableId: string): Promise<GridPayload> {
  const res = await fetch(`/v1/schools/demo/timetables/${timetableId}/grid`, {
    headers: authHeaders()
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? 'Không tải được lưới.');
  return body as GridPayload;
}

export async function patchMove(
  lessonId: string,
  toSlot: number,
  dict: GridDict,
  expectedVersion: number
): Promise<{ ok: true; result: MoveResult } | { ok: false; message: string; conflicts?: any[] }> {
  const P = dict.periods.length;
  const pos = toSlot % P;
  const dayIdx = Math.floor(toSlot / P);
  const period = dict.periods[pos];
  // v1 khung demo: dayOfWeek suy từ cột hiển thị (0=Thứ2..5=Thứ7)
  const dayOfWeek = dayIdx + 1;
  const res = await fetch(`/v1/lessons/${lessonId}/move`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      toSlot: { dayOfWeek, periodId: period?.id ?? '' },
      expectedVersion
    })
  });
  const body = await res.json();
  if (!res.ok) {
    return { ok: false, message: body?.error?.message ?? 'Không đặt được.', conflicts: body?.error?.details?.conflicts };
  }
  return { ok: true, result: body as MoveResult };
}

export const slotKey = (cls: number, slot: number) => `${cls}:${slot}`;

/* ================= Catalog helpers cho các trang nghiệp vụ ================= */

export interface YearRow { id: string; name: string; isActive: boolean; activeDays?: number[] }
export interface PeriodRow {
  id: string; session: string; ordinal: number; name: string;
  start: string | null; end: string | null; dayPosition: number;
}
export interface TeacherListRow { id: string; code: string; fullName: string; shortName?: string | null }
export interface WorkloadRow { teacher_id: string; assigned: number; limit?: number }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: authHeaders() });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.message ?? 'Lỗi tải dữ liệu');
  return body as T;
}

export const listYears = (school: string) =>
  getJson<{ data: YearRow[] }>(`/v1/schools/${school}/years`).then((r) => r.data);

export const listPeriods = (school: string, yid: string) =>
  getJson<{ data: PeriodRow[] }>(`/v1/schools/${school}/years/${yid}/periods`).then((r) => r.data);

export const listTeachers = (school: string, yid: string) =>
  getJson<{ data: TeacherListRow[] }>(`/v1/schools/${school}/years/${yid}/teachers`).then((r) => r.data);

export const fetchWorkload = (school: string, yid: string) =>
  getJson<{ data: WorkloadRow[] }>(`/v1/schools/${school}/years/${yid}/teachers/workload`).then((r) => r.data);

export interface AvSlot { dayOfWeek: number; periodId: string; preference: string; reason?: string | null; isRecurring?: boolean }
export const getAvailability = (school: string, yid: string, ownerId: string) =>
  getJson<{ data: AvSlot[] }>(`/v1/schools/${school}/years/${yid}/availability?ownerType=teacher&ownerId=${ownerId}`).then((r) => r.data);

export async function putAvailability(school: string, yid: string, ownerId: string, slots: AvSlot[]) {
  const res = await fetch(`/v1/schools/${school}/years/${yid}/availability?ownerType=teacher&ownerId=${ownerId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ slots })
  });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b?.error?.message ?? 'Lưu lịch bận thất bại');
  }
}

export interface RolloverPreview {
  sourceYear: string;
  span: { first: number; last: number };
  mappings: Array<{ sourceId: string | null; targetName: string | null; gradeOrdinal: number;
                    action: 'promote'|'graduate'|'create'|'skip'; auto: boolean; note?: string }>;
  assignments: { mode: string; items: Array<{ newClassId: string; subjectId: string; teacherId: string | null; periodsPerWeek: number }> };
  warnings: Array<{ kind: string; message: string }>;
}
export const rolloverPreview = (school: string, q: Record<string,string|number|undefined>) => {
  const qs = new URLSearchParams(
    Object.entries(q).filter(([,v]) => v !== undefined && v !== '').map(([k,v]) => [k,String(v)])
  ).toString();
  return getJson<RolloverPreview>(`/v1/schools/${school}/rollover/preview?${qs}`);
};
