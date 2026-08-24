import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRowsToProblem, resultToWrites } from './db-map.ts';
import { solve } from '@tkb/solver-core';
import type { MapInput } from './db-map.ts';

/** Thế giới nhỏ: 2 ngày (T2, T3) × 2 tiết, 1 lớp, 1 GV, 1 môn 2 tiết */
function tinyInput(): MapInput {
  return {
    activeDays: [1, 2],
    periods: [
      { id: 'p1', session: 'morning', dayPosition: 1 },
      { id: 'p2', session: 'morning', dayPosition: 2 }
    ],
    classes: ['c1'],
    teachers: ['t1'],
    subjects: ['s1'],
    assignments: [{
      id: 'a1', subjectId: 's1', classIds: ['c1'], teacherIds: ['t1'],
      difficulty: 3, maxPerDay: 1
    }],
    lessons: [{ assignmentId: 'a1' }, { assignmentId: 'a1' }],
    availability: []
  };
}

test('allowMask: ô bận của GV bị chặn cứng', () => {
  const input = tinyInput();
  input.availability = [{ ownerType: 'teacher', ownerId: 't1', dayOfWeek: 1, periodId: 'p1', preference: 'busy' }];
  const { problem } = mapRowsToProblem(input);

  const S = problem.days * problem.periodsPerDay; // 4
  assert.equal(S, 4);
  // slot 0 = T2 tiết 1 -> phải bị chặn cho assignment a1
  const m = problem.allowMasks![0];
  assert.equal((m[0] & 1) === 0, true, 'slot 0 phải tắt bit');
  assert.equal((m[0] & 0b1110) !== 0, true, 'các slot khác vẫn mở');
});

test('session filter: phân công buổi chiều loại hết tiết sáng', () => {
  const input = tinyInput();
  input.assignments[0].session = 'afternoon';
  const { problem } = mapRowsToProblem(input);
  // cả p1,p2 đều morning -> mask trống hoàn toàn
  assert.equal(problem.allowMasks![0].every((w) => w === 0), true);
});

test('slotToCell + resultToWrites: khớp ngược về id gốc', () => {
  const input = tinyInput();
  const { problem, ctx } = mapRowsToProblem(input);
  // xếp tay: tiết 0 vào slot 1 (T2p2), tiết 1 vào slot 2 (T3p1)
  const slots = Int32Array.from([1, 2]);
  const writes = resultToWrites(slots, ctx);
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes.map((w) => [w.dayOfWeek, w.periodId]).sort(),
    [[1, 'p2'], [2, 'p1']]
  );
  assert.ok(writes.every((w) => w.assignmentId === 'a1'));
  assert.deepEqual(writes[0].classIds, ['c1']);
  assert.deepEqual(writes[0].teacherIds, ['t1']);
  void problem;
});

test('Round-trip đầy đủ: mapRowsToProblem -> solve -> writes hợp lệ', () => {
  // 3 ngày × 4 tiết, 2 lớp, 4 GV, mỗi cặp (lớp,môn) 3 tiết — đủ phức tạp để SA chạy
  const periods = Array.from({ length: 4 }, (_, i) => ({
    id: 'p' + (i + 1), session: i < 3 ? 'morning' as const : 'afternoon' as const,
    dayPosition: i + 1
  }));
  const input: MapInput = {
    activeDays: [1, 2, 3],
    periods,
    classes: ['cA', 'cB'],
    teachers: ['t1', 't2', 't3', 't4'],
    subjects: ['sTOAN', 'sVAN'],
    assignments: [],
    lessons: [],
    availability: []
  };
  for (const cls of input.classes) {
    for (const subj of input.subjects) {
      const t = subj === 'sTOAN' ? 't1' : 't2'; // cố tình dùng ít GV tạo áp lực
      input.assignments.push({
        id: `${cls}-${subj}`, subjectId: subj,
        classIds: [cls], teacherIds: [t], difficulty: 4, maxPerDay: 1
      });
    }
  }
  for (const a of input.assignments) {
    for (let k = 0; k < 3; k++) input.lessons.push({ assignmentId: a.id });
  }

  const { problem, ctx } = mapRowsToProblem(input);
  const res = solve(problem, { timeLimitMs: 900, seed: 77 });
  assert.equal(res.complete, true, `phải đặt đủ: ${res.placed}/${res.totalLessons}`);

  const writes = resultToWrites(res.slots, ctx);
  assert.equal(writes.length, res.totalLessons);
  // Không hai write nào cùng (lớp, ngày, tiết)
  const seen = new Set<string>();
  for (const w of writes) {
    for (const cid of w.classIds) {
      const key = `${cid}:${w.dayOfWeek}:${w.periodId}`;
      assert.ok(!seen.has(key), `trùng lịch tại ${key}`);
      seen.add(key);
    }
  }
});
