import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TimetableState } from './state.ts';
import { explainMove } from './explain.ts';
import { W } from './types.ts';
import type { ProblemInput } from './types.ts';

/* ==========================================================================
   1. Ca vàng tính tay — D=5, P=4 (slot 0..3 = Thứ Hai, 4..7 = Thứ Ba, ...)
   ========================================================================== */

function microProblem(): ProblemInput {
  return {
    days: 5,
    periodsPerDay: 4,
    numClasses: 1,
    numTeachers: 1,
    numSubjects: 2,
    assignments: [
      { classes: [0], teachers: [0], subject: 0, difficulty: 5, maxPerDay: 1 },
      { classes: [0], teachers: [0], subject: 1, difficulty: 1, maxPerDay: 1 }
    ],
    lessonAssignment: [0, 0, 1],
    teacherMaxPerDay: [6]
  };
}

test('Ca vàng: trạng thái đầu = 55(CD) + 20(TD) + 10(S7) + 15(S3) + 18(S9) = 118', () => {
  const st = new TimetableState(microProblem());
  st.place(0, 0); // Toán   — Thứ 2 tiết 1 (diff 5)
  st.place(1, 2); // Toán   — Thứ 2 tiết 3: trùng môn + hở ô giữa
  st.place(2, 4); // Văn    — Thứ 3 tiết 1
  st.recomputeAll();

  const cd = st.unitCDParts(0, 0);
  assert.equal(cd.gap, W.S1_CLASS_GAP);        // span 3 ô, chỉ 2 tiết -> hở 1
  assert.equal(cd.s4, W.S4_SAME_SUBJECT_DAY);  // Toán x2 > maxPerDay 1
  assert.equal(cd.s5, 0);                      // tiết 3 -> max(0, 2-2) = 0
  assert.equal(st.unitTDParts(0, 0).gap, W.S2_TEACHER_GAP);

  // CW: tải [2,1,0,0,0], fair=ceil(3/5)=1 -> vượt 1 ngày x 1 tiết
  assert.equal(st.ucw[0], W.S7_CLASS_LOAD_BALANCE * 1);
  // TW: GV dùng 2 ngày, fair=ceil(3/6)=1 -> thừa 1 ngày
  assert.equal(st.utw[0], W.S3_TEACHER_DAYS * 1);
  // S9: 2 tiết Toán cách nhau 0 ngày < floor(5/2)=2
  assert.equal(st.ucs[0 * 2 + 0], W.S9_SUBJECT_SPREAD);

  assert.equal(st.total, 118);
});

test('Di chuyển tăng dần khớp tính lại toàn bộ qua 3 bước liên tiếp', () => {
  const st = new TimetableState(microProblem());
  st.place(0, 0); st.place(1, 2); st.place(2, 4);
  st.recomputeAll();
  assert.equal(st.total, 118);

  /* Bước 1: l1 từ slot2 (T2p3) sang slot6 (T3p3)
     CD00 mất cả gap lẫn S4:  55 -> 0          (-55)
     CD01 thêm l1 cạnh l2:    0  -> 30         (+30, gap 1 ô)
     TD00: 20 -> 0 (-20); TD01: 0 -> 20 (+20)
     CW/TW/S9 không đổi
     tổng mới = 93, delta = -25                                */
  assert.equal(st.deltaMove(1, 6), -25);
  st.move(1, 6);
  assert.equal(st.total, 93);

  /* Bước 2: l1 từ slot6 về slot1 (T2p2, cạnh l0)
     CD00: 0 -> 25 (chỉ còn S4; gap 0 vì span 2 ô đủ 2 tiết)
     CD01: 30 -> 0; TD10: 20 -> 0
     tổng mới = 68, delta = -25                                */
  assert.equal(st.deltaMove(1, 1), -25);
  st.move(1, 1);
  assert.equal(st.total, 68);

  /* Bước 3: gỡ l2 (Văn, slot4) về kho
     các đơn vị ngày của nó vốn đã 0; TW mất 1 ngày đến trường (-15)
     cộng phạt UNPLACED +500
     tổng mới = 553, delta = +485                              */
  assert.equal(st.deltaMove(2, -1), 485);
  st.move(2, -1);
  assert.equal(st.total, 553);

  /* Kiểm chứng chéo: dựng lại từ đầu phải ra đúng số đang giữ */
  const fresh = new TimetableState(microProblem());
  fresh.place(0, 0); fresh.place(1, 1);
  fresh.recomputeAll();
  assert.equal(fresh.total, st.total);
});

test('explainMove: quy kết lý do CỘNG ĐÚNG bằng delta (ca quá định mức)', () => {
  /* Hai lớp chung một GV, định mức 1 tiết/ngày.
     Đưa tiết của lớp 2 vào cùng ngày -> S6 +40, không lý do nào khác. */
  const pr: ProblemInput = {
    days: 5, periodsPerDay: 4,
    numClasses: 2, numTeachers: 1, numSubjects: 1,
    assignments: [
      { classes: [0], teachers: [0], subject: 0, difficulty: 1 },
      { classes: [1], teachers: [0], subject: 0, difficulty: 1 }
    ],
    lessonAssignment: [0, 1],
    teacherMaxPerDay: [1]
  };
  const names = {
    className: (c: number) => (c === 0 ? '10A1' : '10A2'),
    teacherName: () => 'T.Hùng',
    subjectName: () => 'Toán',
    dayName: () => 'Thứ Hai'
  };
  const st = new TimetableState(pr);
  st.place(0, 0); // 10A1 — Thứ 2 tiết 1
  st.place(1, 4); // 10A2 — Thứ 3 tiết 1
  st.recomputeAll();
  assert.equal(st.total, 0);

  const ex = explainMove(st, 1, 1, names); // dời 10A2 vào ngay sau 10A1 cùng sáng
  const sum = ex.reasons.reduce((s, r) => s + r.penalty, 0);
  assert.equal(ex.delta, W.S6_TEACHER_OVERLOAD);
  assert.equal(sum, ex.delta, 'tổng penalty của lý do phải bằng delta');
  assert.deepEqual(ex.reasons.map(r => r.code), ['S6']);
});

test('canPlace chặn trùng lớp và trùng giáo viên', () => {
  const st = new TimetableState(microProblem());
  st.place(0, 5);
  assert.equal(st.canPlace(1, 5), false); // cùng GV + cùng lớp
  assert.equal(st.canPlace(2, 5), false);
  assert.equal(st.canPlace(1, -1), false);
  assert.equal(st.canPlace(1, 99), false);
});

/* ==========================================================================
   2. Random walk: incremental PHẢI bằng recomputeAll đầy đủ
   ========================================================================== */

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomProblem(seed: number): ProblemInput {
  const rnd = seededRandom(seed);
  const D = 6, P = 5;
  const pr: ProblemInput = {
    days: D, periodsPerDay: P,
    numClasses: 4, numTeachers: 8, numSubjects: 4,
    assignments: [], lessonAssignment: [],
    teacherMaxPerDay: Array.from({ length: 8 }, () => 5)
  };
  for (let s = 0; s < 4; s++) {
    for (let k = 0; k < 2; k++) {
      pr.assignments.push({
        classes: [(s + k) % 4],
        teachers: [s * 2 + k],
        subject: s,
        difficulty: 1 + ((rnd() * 5) | 0),
        maxPerDay: rnd() < 0.5 ? 1 : 2
      });
    }
  }
  pr.assignments.forEach((_a, i) => {
    for (let k = 0; k < 3; k++) pr.lessonAssignment.push(i);
  });
  return pr;
}

test('Random walk 600 bước: incremental === full recompute tại mỗi mốc 50 bước', () => {
  const rnd = seededRandom(20260824);
  const pr = randomProblem(42);
  const st = new TimetableState(pr);

  for (let li = 0; li < st.numLessons; li++) {
    for (let s = 0; s < st.S(); s++) {
      if (st.canPlace(li, s)) { st.place(li, s); break; }
    }
  }
  st.recomputeAll();

  let moves = 0;
  while (moves < 600) {
    const li = (rnd() * st.numLessons) | 0;
    const to = (rnd() * st.S()) | 0;
    if (!st.canPlace(li, to)) continue;

    const delta = st.deltaMove(li, to);
    const before = st.total;
    st.move(li, to);

    assert.ok(Math.abs((before + delta) - st.total) < 1e-9,
      `delta không khớp tại bước ${moves}`);
    moves++;

    if (moves % 50 === 0) {
      const expected = st.total;
      st.recomputeAll();
      assert.ok(Math.abs(expected - st.total) < 1e-9,
        `lệch incremental vs full tại bước ${moves}: ${expected} != ${st.total}`);
    }
  }
});
