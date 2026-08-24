import { TimetableState } from '@tkb/cost-core';
import { Engine } from './engine.ts';
import { phaseA } from './phase-a.ts';
import { phaseB } from './phase-b.ts';
import type { SolverProblem, SolverOptions, SolveResult, ProgressEvent } from './types.ts';

export type { SolverProblem, SolverOptions, SolveResult, ProgressEvent };

/**
 * solve() — điều phối hai pha (solver spec §1):
 *   Pha A dựng lời giải hợp lệ (greedy + ejection)
 *   Pha B tối ưu ràng buộc mềm bằng SA (M1/M2/Kempe)
 * Pha A thất bại -> KHÔNG chuyển Pha B, trả complete:false kèm phần đã đặt.
 */
export function solve(problem: SolverProblem, opts: SolverOptions = {}): SolveResult {
  const timeLimitMs = opts.timeLimitMs ?? 4000;
  const startedAt = Date.now();
  const deadline = startedAt + timeLimitMs;
  const eng = new Engine(problem, opts.seed ?? 1);
  eng.placePinned();

  let iterations = 0;

  const tA = Math.min(deadline - 50, Date.now() + Math.max(200, timeLimitMs * 0.35));
  const a = phaseA(eng, tA);
  eng.st.recomputeAll();
  const placedA = countPlaced(eng);

  opts.onProgress?.({
    phase: 'A', percent: a.failures.length ? 20 : 25,
    placed: placedA, total: eng.st.numLessons,
    softScore: Math.round(eng.st.total), iterations
  });

  if (!a.failures.length && opts.runPhaseB !== false) {
    let lastEmit = 0;
    opts.onProgress?.({
      phase: 'B', percent: 25,
      placed: placedA, total: eng.st.numLessons,
      softScore: Math.round(eng.st.total), iterations
    });
    const b = phaseB(eng, deadline, (score) => {
      iterations++;
      const now = Date.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        opts.onProgress?.({
          phase: 'B',
          percent: Math.min(99, 25 + Math.round(((now - startedAt) / timeLimitMs) * 74)),
          placed: countPlaced(eng), total: eng.st.numLessons,
          softScore: score, iterations
        });
      }
    });
    iterations += b.iterations;
    opts.onProgress?.({
      phase: 'B', percent: 100,
      placed: countPlaced(eng), total: eng.st.numLessons,
      softScore: b.bestScore, iterations
    });
  }

  // Trạng thái cuối đã là best snapshot (phaseB khôi phục). Kiểm tra chéo lần cuối.
  eng.st.recomputeAll();
  const placed = countPlaced(eng);
  return {
    slots: Int32Array.from(eng.st.slots),
    softScore: Math.round(eng.st.total),
    placed,
    totalLessons: eng.st.numLessons,
    iterations,
    complete: a.failures.length === 0 && placed === eng.st.numLessons
  };
}

/** Dựng lại trạng thái độc lập từ kết quả — dùng để kiểm chứng bất biến. */
export function verifyResult(problem: SolverProblem, result: SolveResult): {
  hardViolations: number;
  unplaced: number;
} {
  const st = new TimetableState(problem);
  for (let li = 0; li < result.slots.length; li++) {
    if (result.slots[li] >= 0) st.place(li, result.slots[li]);
  }
  let hardViolations = 0;
  const S = st.S();
  // Quét trùng lớp/GV qua bảng occ do place tự dựng: mỗi ô chỉ giữ một tiết,
  // nên đếm số lần "đè" bằng cách thử đặt lại và so chỉ số
  const clsSeen = new Map<number, number>();
  const teaSeen = new Map<number, number>();
  for (let li = 0; li < result.slots.length; li++) {
    const s = result.slots[li];
    if (s < 0 || s >= S) { if (s >= S) hardViolations++; continue; }
    const aid = problem.lessonAssignment[li];
    for (const c of problem.assignments[aid].classes) {
      const key = c * S + s;
      if (clsSeen.has(key)) hardViolations++;
      clsSeen.set(key, li);
    }
    for (const t of problem.assignments[aid].teachers) {
      const key = t * S + s;
      if (teaSeen.has(key)) hardViolations++;
      teaSeen.set(key, li);
    }
  }
  let unplaced = 0;
  for (const s of result.slots) if (s < 0) unplaced++;
  return { hardViolations, unplaced };
}

function countPlaced(eng: Engine): number {
  let n = 0;
  for (let i = 0; i < eng.st.numLessons; i++) if (eng.st.slots[i] >= 0) n++;
  return n;
}
