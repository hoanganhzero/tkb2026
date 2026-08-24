/**
 * Khoá mềm cấp lớp — quy tắc thuần từ tkb_api_spec.md mục 6.
 * TTL 60s · heartbeat 20s · takeover: owner/admin luôn, scheduler chỉ khi
 * khoá "im lặng" quá 5 phút (không có thao tác ghi dù heartbeat vẫn chạy).
 * Bảng timetable_locks với UNIQUE(timetable_id, class_id) đảm bảo giành khoá
 * nguyên tử ở CSDL — module này chỉ quyết định AI ĐƯỢC PHÉP.
 */

export const LOCK_TTL_MS = 60_000;
export const HEARTBEAT_MS = 20_000;
export const SILENT_THRESHOLD_MS = 5 * 60_000;

export interface LockRow {
  classId: string;
  userId: string;
  userName: string;
  /** epoch ms */
  expiresAt: number;
  /** epoch ms lần ghi cuối cùng của người giữ khoá */
  lastWriteAt: number;
}

export interface AcquireContext {
  userId: string;
  role: 'owner' | 'admin' | 'scheduler' | 'teacher' | 'viewer';
  /** epoch ms — mặc định Date.now() */
  now?: number;
}

export interface DeniedLock {
  classId: string;
  userName: string;
  userId: string;
  expiresAt: number;
  silent: boolean;
}

export interface AcquireResult {
  granted: string[];
  denied: DeniedLock[];
}

export function isSilent(lock: LockRow, now: number): boolean {
  return now - lock.lastWriteAt > SILENT_THRESHOLD_MS;
}

export function canTakeover(
  role: AcquireContext['role'],
  lock: LockRow,
  now: number,
): boolean {
  if (role === 'owner' || role === 'admin') return true;
  if (role === 'scheduler') return isSilent(lock, now);
  return false;
}

/**
 * Xin khoá cho một loạt lớp — cấp từng phần: được lớp nào cấp lớp đó,
 * người dùng làm việc ngay trên phần được cấp không phải chờ (§6.4).
 * Khoá đã hết hạn (expiresAt <= now) coi như trống.
 */
export function evaluateAcquire(
  existing: LockRow[],
  requestedClassIds: string[],
  ctx: AcquireContext,
  takeover = false,
): AcquireResult {
  const now = ctx.now ?? Date.now();
  const byClass = new Map(existing.map((l) => [l.classId, l] as const));

  const granted: string[] = [];
  const denied: DeniedLock[] = [];

  for (const classId of requestedClassIds) {
    const lock = byClass.get(classId);
    if (!lock || lock.expiresAt <= now) {
      granted.push(classId);
      continue;
    }
    if (lock.userId === ctx.userId) {
      // Khoá của chính mình -> coi như gia hạn lại (granted để client re-acquire TTL)
      granted.push(classId);
      continue;
    }
    if (takeover && canTakeover(ctx.role, lock, now)) {
      granted.push(classId);
      continue;
    }
    denied.push({
      classId,
      userId: lock.userId,
      userName: lock.userName,
      expiresAt: lock.expiresAt,
      silent: isSilent(lock, now),
    });
  }

  return { granted, denied };
}
