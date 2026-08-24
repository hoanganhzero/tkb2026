import type { Engine } from './engine.ts';
import { difficultyScore } from './engine.ts';

export interface PhaseAResult {
  failures: number[];
  ejected: number;
}

/**
 * Pha A — dựng lời giải hợp lệ: greedy theo thứ tự khó-trước + ejection.
 * Mục tiêu DUY NHẤT: đặt hết tiết, 0 xung đột cứng. Chất lượng là việc của Pha B.
 */
export function phaseA(eng: Engine, deadline: number): PhaseAResult {
  const { st, pr } = eng;
  const N = st.numLessons;

  // Thứ tự xếp: domain hẹp trước (MRV), ghim đã đặt từ trước
  const order: number[] = [];
  for (let li = 0; li < N; li++) if (!eng.pinned[li]) order.push(li);
  order.sort((a, b) =>
    difficultyScore(pr, eng.domainSize[b]) - difficultyScore(pr, eng.domainSize[a]) ||
    a - b
  );

  const queue = [...order];
  const fails = new Map<number, number>();
  const failures: number[] = [];
  let ejected = 0;
  const maxEject = 5 * N;

  while (queue.length) {
    if (Date.now() > deadline) break;
    const li = queue.shift()!;

    // Chọn ô tốt nhất trong miền cho phép (chi phí mềm + jitter chống cứng nhắc)
    let best = -1, bestC = Infinity;
    forEachAllowed(eng, li, (s) => {
      if (!st.canPlace(li, s)) return;
      const d = st.deltaMove(li, s) + eng.rnd() * 8;
      if (d < bestC) { bestC = d; best = s; }
    });
    if (best >= 0) { st.move(li, best); continue; }

    // Ejection: đá một tiết đang chiếm ô thuộc miền của li, xếp lại sau
    let done = false;
    if (ejected < maxEject) {
      forEachAllowed(eng, li, (s) => {
        const victim = st.lessonAtClass(firstClass(eng, li), s);
        if (victim < 0 || eng.pinned[victim]) return;
        st.unplace(victim);
        if (st.canPlace(li, s)) {
          st.move(li, s);
          queue.push(victim);
          ejected++;
          done = true;
          return true; // dừng duyệt
        }
        st.place(victim, s); // trả lại, thử ô khác
      });
    }
    if (done) continue;

    const f = (fails.get(li) ?? 0) + 1;
    fails.set(li, f);
    if (f <= 3) queue.push(li);
    else failures.push(li);
  }

  return { failures, ejected };
}

function firstClass(eng: Engine, li: number): number {
  return eng.pr.assignments[eng.pr.lessonAssignment[li]].classes[0];
}

function forEachAllowed(eng: Engine, li: number, cb: (slot: number) => boolean | void): void {
  const mask = eng.lessonAllow[li];
  outer:
  for (let w = 0; w < mask.length; w++) {
    let word = mask[w];
    while (word !== 0) {
      const bit = word & -word;
      const slot = w * 32 + 31 - Math.clz32(bit);
      word ^= bit;
      if (cb(slot) === true) break outer;
    }
  }
}
