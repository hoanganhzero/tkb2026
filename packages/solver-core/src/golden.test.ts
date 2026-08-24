import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solve, verifyResult } from './solve.ts';
import type { SolverProblem } from './types.ts';

/* ==========================================================================
   Bộ dữ liệu chuẩn rút gọn — tinh thần của solver spec §13 nhưng đủ nhanh
   để chạy trong test (mục tiêu < 4 giây toàn bộ file).
   ========================================================================== */

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Trường nhỏ: 9 lớp × 17 tiết, 6 môn × 3 GV, có lịch bận ngẫu nhiên.
 *  Mỗi (lớp,môn) là MỘT assignment riêng chia GV theo vòng tròn — KHÔNG phải
 *  assignment gộp 3 lớp (gộp lớp nghĩa là ba lớp HỌC CHUNG một tiết). */
function schoolProblem(seed: number): SolverProblem {
  const rnd = seededRandom(seed);
  const D = 6, P = 5, S = D * P, WWORDS = Math.ceil(S / 32);
  const numSubjects = 6, teachersPerSubject = 3;
  const ppw = [4, 4, 3, 2, 2, 2]; // tổng 17 tiết/lớp
  const numClasses = 9;

  const assignments: SolverProblem['assignments'] = [];
  const lessonAssignment: number[] = [];
  const allowMasks: Uint32Array[] = [];

  // Lịch bận của từng GV: vài GV nghỉ cả Thứ Bảy, cộng ô lẻ ngẫu nhiên
  const numTeachers = numSubjects * teachersPerSubject;
  const teacherMasks: Uint32Array[] = [];
  for (let t = 0; t < numTeachers; t++) {
    const mask = new Uint32Array(WWORDS).fill(0xFFFFFFFF);
    if (rnd() < 0.35) {
      for (let p = 0; p < P; p++) mask[(5 * P + p) >>> 5] &= ~(1 << ((5 * P + p) & 31));
    }
    for (let s = 0; s < S; s++) if (rnd() < 0.06) mask[s >>> 5] &= ~(1 << (s & 31));
    teacherMasks.push(mask);
  }

  for (let ci = 0; ci < numClasses; ci++) {
    for (let si = 0; si < numSubjects; si++) {
      const t = si * teachersPerSubject + (ci % teachersPerSubject);
      const aid = assignments.length;
      assignments.push({
        classes: [ci],
        teachers: [t],
        subject: si,
        difficulty: 1 + ((rnd() * 5) | 0),
        maxPerDay: 1
      });
      allowMasks.push(Uint32Array.from(teacherMasks[t]));
      for (let k = 0; k < ppw[si]; k++) lessonAssignment.push(aid);
    }
  }

  return {
    days: D, periodsPerDay: P,
    numClasses, numTeachers, numSubjects,
    assignments, lessonAssignment, allowMasks
  };
}

const HARD_TIME_MS = 2500;

test('Pha A + B: đặt kín mọi tiết, 0 xung đột cứng, SA không tệ hơn greedy', () => {
  const pr = schoolProblem(7);
  const totalLessons = pr.lessonAssignment.length;

  const aOnly = solve(pr, { timeLimitMs: 1200, seed: 42, runPhaseB: false });
  assert.equal(aOnly.complete, true, `Pha A phải đặt đủ: ${aOnly.placed}/${totalLessons}`);
  const vA = verifyResult(pr, aOnly);
  assert.equal(vA.hardViolations, 0, 'greedy không được tạo xung đột cứng');
  assert.equal(vA.unplaced, 0);

  const full = solve(pr, { timeLimitMs: HARD_TIME_MS, seed: 42 });
  const vB = verifyResult(pr, full);
  assert.equal(vB.hardViolations, 0, 'SA phải giữ bất biến ràng buộc cứng');
  assert.equal(vB.unplaced, 0);
  assert.ok(full.softScore <= aOnly.softScore,
    `Pha B phải không tệ hơn Pha A: ${full.softScore} <= ${aOnly.softScore}`);
});

test('Cùng seed cho cùng kết quả (deterministic)', () => {
  const pr = schoolProblem(11);
  const r1 = solve(pr, { timeLimitMs: 900, seed: 123 });
  const r2 = solve(pr, { timeLimitMs: 900, seed: 123 });
  assert.equal(r1.softScore, r2.softScore);
  assert.deepEqual(Array.from(r1.slots), Array.from(r2.slots));
});

test('Ghim tiết: vị trí ghim được bảo vệ tuyệt đối qua cả hai pha', () => {
  const pr = schoolProblem(13);
  const pinnedSlots: number[] = new Array(pr.lessonAssignment.length).fill(-1);
  // Ghim tiết đầu tiên vào Thứ Hai tiết 1 (slot 0) và tiết cuối vào slot 29
  pinnedSlots[0] = 0;
  pinnedSlots[pr.lessonAssignment.length - 1] = 29;
  pr.pinnedSlots = pinnedSlots;

  const res = solve(pr, { timeLimitMs: 1200, seed: 99 });
  assert.equal(res.slots[0], 0, 'ghim slot 0 bị vi phạm');
  assert.equal(res.slots[res.totalLessons - 1], 29, 'ghim slot 29 bị vi phạm');
  const v = verifyResult(pr, res);
  assert.equal(v.hardViolations, 0);
});

test('Progress events: phát theo pha, phần trăm tăng dần', () => {
  const pr = schoolProblem(17);
  const events = [];
  solve(pr, {
    timeLimitMs: 800, seed: 5,
    onProgress: (e) => events.push(e)
  });
  assert.ok(events.some((e) => e.phase === 'A'));
  assert.ok(events.some((e) => e.phase === 'B'));
  for (let i = 1; i < events.length; i++) {
    assert.ok(events[i].percent >= events[i - 1].percent, 'percent phải không giảm');
  }
});

test('Bài toán quá chặt: báo complete=false thay vì trả lời giải sai', () => {
  // Một GV gánh toàn bộ 30 tiết trên khung 30 ô với lịch bận dày -> không đủ chỗ
  const D = 6, P = 5, S = D * P, WWORDS = Math.ceil(S / 32);
  const assignments: SolverProblem['assignments'] = [
    { classes: [0], teachers: [0], subject: 0, difficulty: 1 },
    { classes: [1], teachers: [0], subject: 0, difficulty: 1 }
  ];
  const mask = new Uint32Array(WWORDS).fill(0xFFFFFFFF);
  for (let s = S - 12; s < S; s++) mask[s >>> 5] &= ~(1 << (s & 31)); // chặn 12 ô cuối
  const pr: SolverProblem = {
    days: D, periodsPerDay: P, numClasses: 2, numTeachers: 1, numSubjects: 1,
    assignments,
    lessonAssignment: [0, 0],
    allowMasks: [mask]
  };
  const res = solve(pr, { timeLimitMs: 600, seed: 3, runPhaseB: false });
  // 2 tiết vẫn vừa trong 18 ô còn lại -> complete; kiểm tra đúng logic:
  assert.equal(res.complete, true);
  assert.equal(res.placed, 2);

  // Chặt hơn: chỉ còn đúng 1 ô cho 2 tiết
  const tightMask = new Uint32Array(WWORDS).fill(0xFFFFFFFF);
  for (let s = 1; s < S; s++) tightMask[s >>> 5] &= ~(1 << (s & 31)); // chỉ slot 0 tự do
  pr.allowMasks = [tightMask];
  const res2 = solve(pr, { timeLimitMs: 600, seed: 3, runPhaseB: false });
  assert.equal(res2.complete, false, 'thiếu miền -> không được báo hoàn thành');
});
