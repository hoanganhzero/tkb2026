import type { ProblemInput } from '@tkb/cost-core';

/** Vấn đề xếp + phần tĩnh của ràng buộc cứng (allowMask ghép sẵn lịch bận). */
export interface SolverProblem extends ProblemInput {
  /** Theo assignment: bitmask W word các ô ĐƯỢC phép (đã AND lịch bận GV/lớp,
   *  buổi học, ngày học). Thiếu = mọi ô đều hợp lệ về phần tĩnh. */
  allowMasks?: ReadonlyArray<Uint32Array>;
  /** Slot ghim cho từng tiết (-1 = tự do). Ghim mâu thuẫn sẽ bị bỏ qua có log. */
  pinnedSlots?: readonly number[];
}

export interface SolverOptions {
  /** Tổng thời gian tối đa cho cả hai pha (ms). Mặc định 4000. */
  timeLimitMs?: number;
  seed?: number;
  /** Chạy Pha A rồi dừng — dùng để so điểm trước/sau tối ưu trong test */
  runPhaseB?: boolean;
  onProgress?: (e: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: 'A' | 'B';
  percent: number;
  placed: number;
  total: number;
  softScore: number;
  iterations: number;
}

export interface SolveResult {
  slots: Int32Array;
  softScore: number;
  placed: number;
  totalLessons: number;
  iterations: number;
  /** true: mọi tiết đã đặt, 0 xung đột cứng — kết quả dùng được ngay */
  complete: boolean;
}

/* ---------- bit helpers ---------- */

export function wordsFor(slots: number): number {
  return Math.ceil(slots / 32);
}

export function fullMask(words: number, totalSlots: number): Uint32Array {
  const m = new Uint32Array(words).fill(0xFFFFFFFF);
  // Bit của slot s nằm ở vị trí thấp: s & 31 trong word s>>>5.
  // Word cuối chỉ được bật đúng số bit còn lại — KHÔNG dịch trái
  // (dịch trái sẽ giữ bit cao và tắt mất các slot hợp lệ đầu tiên).
  const usedInLast = totalSlots - (words - 1) * 32;
  if (usedInLast < 32) {
    m[words - 1] = usedInLast <= 0 ? 0 : ((1 << usedInLast) - 1) >>> 0;
  }
  return m;
}

export function hasBit(mask: Uint32Array | undefined, slot: number): boolean {
  if (!mask) return true;
  const w = mask[slot >>> 5];
  return w !== undefined && (w & (1 << (slot & 31))) !== 0;
}

/** Duyệt các bit đang bật, sớm thoát khi callback trả true */
export function forEachBit(mask: Uint32Array, cb: (slot: number) => boolean | void): void {
  for (let w = 0; w < mask.length; w++) {
    let word = mask[w];
    while (word !== 0) {
      const bit = word & -word;
      const slot = w * 32 + 31 - Math.clz32(bit);
      if (cb(slot) === true) return;
      word ^= bit;
    }
  }
}

export function popcount(mask: Uint32Array): number {
  let n = 0;
  for (let w = 0; w < mask.length; w++) {
    let x = mask[w];
    while (x) { x &= x - 1; n++; }
  }
  return n;
}

export function andInto(target: Uint32Array, other: Uint32Array | undefined): void {
  if (!other) return;
  for (let i = 0; i < target.length && i < other.length; i++) {
    target[i] &= other[i];
  }
}
