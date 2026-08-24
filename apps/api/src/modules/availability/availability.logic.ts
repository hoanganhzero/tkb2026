/**
 * Lưới bận/rảnh GV/lớp/phòng — excel-free thuần từ tkb_design_spec.md §8 +
 * schema availability_slots (UNIQUE owner_type,owner_id,dow,period_id).
 * preference 'busy' chặn cứng solver · 'avoid' phạt mềm S8 (cost-core).
 */

export const PREFERENCES = ['available', 'busy', 'preferred', 'avoid'] as const;
export type Preference = typeof PREFERENCES[number];

export interface SlotIO {
  dayOfWeek: number;        // 1..7 ISO
  periodId: string;
  preference: string;
  reason?: string | null;
  /** rollover §3.2: true = ràng buộc lâu dài mang sang năm sau */
  isRecurring?: boolean;
}

export const slotKey = (s: { dayOfWeek: number; periodId: string }) =>
  `${s.dayOfWeek}|${s.periodId}`;

export interface SlotIssue { index: number; message: string }

/**
 * Kiểm tra + khử trùng lặp trong một request (ô quét chuột trùng nhau dùng lần cuối).
 * @param validPeriodIds tập periodId thuộc năm học hiện hành
 */
export function validateSlots(
  validPeriodIds: ReadonlySet<string>,
  slots: SlotIO[],
): { issues: SlotIssue[]; clean: SlotIO[] } {
  const issues: SlotIssue[] = [];
  const seen = new Map<string, SlotIO>();
  const clean: SlotIO[] = [];

  slots.forEach((s, index) => {
    if (!Number.isInteger(s.dayOfWeek) || s.dayOfWeek < 1 || s.dayOfWeek > 7) {
      issues.push({ index, message: 'dayOfWeek phải là số 1..7 (Thứ Hai..Chủ nhật)' });
      return;
    }
    if (!validPeriodIds.has(s.periodId)) {
      issues.push({ index, message: 'periodId không thuộc năm học hiện hành' });
      return;
    }
    if (!PREFERENCES.includes(s.preference as Preference)) {
      issues.push({ index,
        message: `"${s.preference}" không hợp lệ (${PREFERENCES.join(', ')})` });
      return;
    }
    const k = slotKey(s);
    if (seen.has(k)) {
      issues.push({ index, message: `Trùng ô ${k} trong request — dùng giá trị cuối` });
    }
    seen.set(k, {
      dayOfWeek: s.dayOfWeek,
      periodId: s.periodId,
      preference: s.preference,
      reason: s.reason ?? null,
      isRecurring: s.isRecurring ?? false,
    });
  });

  return { issues, clean: [...seen.values()] };
}

export interface ExistingSlot {
  dayOfWeek: number; periodId: string; preference: string; isRecurring?: boolean;
}

/** Chênh lệch tối thiểu giữa hiện trạng và mong muốn — PUT ghi đè toàn bộ vẫn rẻ */
export function diffSlots(
  existing: ExistingSlot[],
  desired: SlotIO[],
): {
  insert: SlotIO[];
  update: Array<SlotIO & { id?: string }>;
  deleteKeys: string[];
} {
  const exMap = new Map(existing.map((e) => [slotKey(e), e] as const));
  const deMap = new Map(desired.map((d) => [slotKey(d), d] as const));

  const insert = desired.filter((d) => !exMap.has(slotKey(d)));
  const update = desired.filter((d) => {
    const e = exMap.get(slotKey(d));
    return !!e && (e.preference !== d.preference || !!e.isRecurring !== !!d.isRecurring);
  });
  const deleteKeys = existing
    .filter((e) => !deMap.has(slotKey(e)))
    .map((e) => slotKey(e));

  return { insert, update, deleteKeys };
}
