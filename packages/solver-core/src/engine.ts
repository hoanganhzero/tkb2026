import { TimetableState } from '@tkb/cost-core';
import type { SolverProblem } from './types.ts';
import { fullMask, hasBit, popcount, wordsFor, andInto } from './types.ts';

/**
 * Engine dùng chung cho hai pha: trạng thái cost-core + mặt nạ tĩnh
 * allowMask theo tiết (lịch bận GV/lớp đã được AND từ tầng cấu hình).
 */
export class Engine {
  readonly pr: SolverProblem;
  readonly st: TimetableState;
  /** allowMask THEO TIẾT (đã AND các assignment liên quan) */
  readonly lessonAllow: Uint32Array[];
  readonly pinned: Uint8Array;
  readonly rnd: () => number;
  readonly words: number;
  readonly domainSize: number[];

  constructor(pr: SolverProblem, seed: number) {
    this.pr = pr;
    this.st = new TimetableState(pr);
    this.words = wordsFor(this.st.S());
    this.rnd = mulberry32(seed);

    const S = this.st.S();
    this.lessonAllow = [];
    this.domainSize = new Array(this.st.numLessons);
    for (let li = 0; li < this.st.numLessons; li++) {
      const aid = pr.lessonAssignment[li];
      let m = fullMask(this.words, S);
      if (pr.allowMasks?.[aid]) { andInto(m, pr.allowMasks[aid]); }
      // Ghép lớp/nhiều GV: allowMask assignment đã là giao từ tầng trên,
      // ở đây giữ nguyên (mỗi assignment một mask duy nhất).
      this.lessonAllow.push(m);
      this.domainSize[li] = Math.max(1, popcount(m));
    }

    this.pinned = new Uint8Array(this.st.numLessons);
  }

  allowed(li: number, slot: number): boolean {
    return hasBit(this.lessonAllow[li], slot) && this.st.canPlace(li, slot);
  }

  placePinned(): void {
    const pins = this.pr.pinnedSlots;
    if (!pins) return;
    for (let li = 0; li < this.st.numLessons; li++) {
      const s = pins[li];
      if (s == null || s < 0) continue;
      // Ghim là ý định tường minh của người dùng: ưu tiên allowed(), nếu ô
      // chỉ bị CHẶN MỀM bởi lịch bận tĩnh thì vẫn ghim (ghi đè mask);
      // chỉ bỏ qua khi ô đã có tiết khác (xung đột ghim thật).
      if (!this.allowed(li, s)) {
        if (!this.st.canPlace(li, s)) continue;
      }
      this.st.place(li, s);
      this.pinned[li] = 1;
    }
    this.st.recomputeAll();
  }

  randomSlot(): number {
    return (this.rnd() * this.st.S()) | 0;
  }

  randomLesson(placedOnly: boolean): number {
    for (let tries = 0; tries < 64; tries++) {
      const li = (this.rnd() * this.st.numLessons) | 0;
      if (this.pinned[li]) continue;
      if (placedOnly && this.st.slots[li] < 0) continue;
      return li;
    }
    return -1;
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Độ khó xếp — biến thể MRV của solver spec §4.4, càng lớn càng xếp trước. */
export function difficultyScore(pr: SolverProblem, domainSize: number): number {
  void pr;
  return 2 / domainSize;
}
