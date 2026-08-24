import type { Engine } from './engine.ts';
import { m1, m2Swap, kempe } from './moves.ts';
import type { Candidate } from './moves.ts';

/**
 * Pha B — Simulated Annealing trên vùng lời giải hợp lệ (solver spec §7).
 * Dừng bất cứ lúc nào vẫn có best snapshot dùng được ngay.
 */

const W_M1 = 0.35, W_M2 = 0.60; // M1: <.35, M2: <.60, còn lại M3

function calibrate(eng: Engine, deadline: number): number {
  const deltas: number[] = [];
  for (let i = 0; i < 200 && Date.now() < deadline; i++) {
    const cand = randomCandidate(eng);
    if (!cand) continue;
    if (cand.delta > 0) deltas.push(cand.delta);
    cand.revert();
  }
  if (!deltas.length) return 50;
  const avg = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  return avg / Math.log(1 / 0.8);
}

function randomCandidate(eng: Engine): Candidate | null {
  const r = eng.rnd();
  const S = eng.st.S();
  if (r < W_M1) {
    const li = eng.randomLesson(false);
    if (li < 0) return null;
    return m1(eng, li, eng.randomSlot());
  }
  if (r < W_M2) {
    const a = eng.randomLesson(true);
    if (a < 0) return null;
    return m2Swap(eng, a, eng.randomSlot());
  }
  const cls = (eng.rnd() * eng.pr.numClasses) | 0;
  return kempe(eng, cls, (eng.rnd() * S) | 0, (eng.rnd() * S) | 0);
}

export interface PhaseBResult {
  iterations: number;
  bestScore: number;
  finalScore: number;
}

export function phaseB(
  eng: Engine,
  deadline: number,
  onImproved?: (score: number) => void,
): PhaseBResult {
  const st = eng.st;
  st.recomputeAll();

  let T = calibrate(eng, Math.min(deadline, Date.now() + 400));
  let sinceImprove = 0;
  let iterations = 0;

  // Best snapshot: sao chép mảng slots — với ~1.300 tiết vẫn rẻ so với độ phức tạp
  let bestTotal = st.total;
  let bestSnap = Int32Array.from(st.slots);

  while (Date.now() < deadline) {
    for (let batch = 0; batch < 500 && Date.now() < deadline; batch++) {
      const cand = randomCandidate(eng);
      if (!cand) continue;
      iterations++;

      const accept = cand.delta <= 0 || eng.rnd() < Math.exp(-cand.delta / T);
      if (accept) {
        cand.commit(); // no-op với mọi phép hiện tại
        if (st.total < bestTotal) {
          bestTotal = st.total;
          bestSnap = Int32Array.from(st.slots);
          sinceImprove = 0;
          onImproved?.(bestTotal);
        } else {
          sinceImprove++;
        }
      } else {
        cand.revert();
        sinceImprove++;
      }
    }
    T *= 0.9995;
    // Hâm nóng lại khi bế tắc
    if (sinceImprove > 400) {
      T = calibrate(eng, Math.min(deadline, Date.now() + 300)) * 0.35;
      sinceImprove = 0;
    }
  }

  // Khôi phục lời giải tốt nhất từng thấy
  if (bestTotal < st.total) {
    for (let li = 0; li < st.numLessons; li++) {
      if (eng.pinned[li]) continue;
      st.unplace(li);
    }
    for (let li = 0; li < st.numLessons; li++) {
      if (eng.pinned[li] || bestSnap[li] < 0) continue;
      st.place(li, bestSnap[li]);
    }
    st.recomputeAll();
  }

  return { iterations, bestScore: Math.min(bestTotal, st.total), finalScore: st.total };
}
