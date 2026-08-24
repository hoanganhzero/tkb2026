import type { Engine } from './engine.ts';

/**
 * Các phép biến đổi giữ bất biến "chỉ đi trong vùng lời giải hợp lệ":
 *   M1 di chuyển đơn · M2 hoán đổi trong lớp · M3 Kempe chain
 * Mỗi hàm ÁP DỤNG NGAY và trả về { delta, revert() } — SA gọi revert nếu từ chối.
 */

export interface Candidate {
  delta: number;
  /** Không-op với M1/M2 (đã áp dụng); giữ cho đồng nhất giao diện */
  commit(): void;
  revert(): void;
}

/** M1 — dời một tiết sang ô trống hợp lệ. */
export function m1(eng: Engine, li: number, to: number): Candidate | null {
  if (eng.pinned[li]) return null;
  if (!eng.allowed(li, to)) return null;
  const from = eng.st.slots[li];
  const before = eng.st.total;
  eng.st.move(li, to);
  return {
    delta: eng.st.total - before,
    commit() {},
    revert() { eng.st.move(li, from); }
  };
}

/** M2 — hoán đổi hai tiết của cùng một lớp (đích được dọn trước nên an toàn). */
export function m2Swap(eng: Engine, a: number, s2: number): Candidate | null {
  const st = eng.st;
  if (eng.pinned[a] || st.slots[a] < 0) return null;
  const cls = eng.pr.assignments[eng.pr.lessonAssignment[a]].classes[0];
  const b = st.lessonAtClass(cls, s2);
  if (b < 0 || b === a || eng.pinned[b]) return null;

  const sa = st.slots[a];
  if (!staticAllowed(eng, a, s2) || !staticAllowed(eng, b, sa)) return null;

  // Kiểm tra occupancy ĐỘNG đầy đủ mọi trục (lớp + GV): mặt nạ tĩnh một mình
  // không đủ — GV của a có thể đang bận ở s2 qua một lớp khác.
  const before = st.total;
  st.unplace(b);
  const okA = st.canPlace(a, s2);
  const okB = okA && st.canPlace(b, sa);
  if (!okA || !okB) {
    st.place(b, s2); // trả lại nguyên trạng
    return null;
  }

  const apply = () => {
    st.unplace(b);
    st.move(a, s2);
    st.move(b, sa);
  };
  const undo = () => {
    st.unplace(a);
    st.move(b, s2);
    st.move(a, sa);
  };
  apply();
  return { delta: st.total - before, commit() {}, revert: undo };
}

/**
 * M3 — Kempe chain: hoán đổi nội dung hai ô của một lớp, kéo dây chuyền mọi
 * tiết vướng giáo viên/lớp. Áp dụng kiểu SNAPSHOT: gỡ cả dây chuyền, đặt lại
 * vào ô đích, recomputeAll MỘT lần — đúng tuyệt đối, không lo ghi đè occupancy.
 */
export function kempe(eng: Engine, cls: number, s1: number, s2: number): Candidate | null {
  const st = eng.st;
  if (s1 === s2) return null;
  const seedA = st.lessonAtClass(cls, s1);
  const seedB = st.lessonAtClass(cls, s2);
  if (seedA < 0 && seedB < 0) return null;

  const seen = new Set<number>();
  const chain: number[] = [];
  const queue: number[] = [];
  if (seedA >= 0) queue.push(seedA);
  if (seedB >= 0) queue.push(seedB);

  while (queue.length) {
    const l = queue.pop()!;
    if (seen.has(l)) continue;
    if (eng.pinned[l]) return null;
    seen.add(l);
    chain.push(l);
    if (chain.length > 8) return null;

    const from = st.slots[l];
    const to = from === s1 ? s2 : s1;
    if (!staticAllowed(eng, l, to)) return null;

    const aid = eng.pr.lessonAssignment[l];
    for (const t of eng.pr.assignments[aid].teachers) {
      const blocker = st.lessonAtTeacher(t, to);
      if (blocker >= 0 && !seen.has(blocker)) queue.push(blocker);
    }
    for (const c of eng.pr.assignments[aid].classes) {
      const blocker = st.lessonAtClass(c, to);
      if (blocker >= 0 && !seen.has(blocker)) queue.push(blocker);
    }
  }

  const origs = chain.map((l) => st.slots[l]);
  const targetOf = (i: number) => (origs[i] === s1 ? s2 : s1);

  const apply = () => {
    for (const l of chain) st.unplace(l);
    chain.forEach((_l, i) => st.place(chain[i], targetOf(i)));
    st.recomputeAll();
  };
  const undo = () => {
    for (const l of chain) st.unplace(l);
    chain.forEach((l, i) => st.place(l, origs[i]));
    st.recomputeAll();
  };

  const before = st.total;
  apply();
  return { delta: st.total - before, commit() {}, revert: undo };
}

function staticAllowed(eng: Engine, li: number, slot: number): boolean {
  const mask = eng.lessonAllow[li];
  const w = mask[slot >>> 5];
  return w !== undefined && (w & (1 << (slot & 31))) !== 0;
}
