import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMatrix, planApply } from './matrix.ts';
import type { ClassRow, SubjectRow, RawAssignment, PoolRow } from './matrix.ts';

const classes: ClassRow[] = [
  { id: 'cA', name: '10A1', gradeId: 'g10', gradeOrdinal: 10 },
  { id: 'cB', name: '10A2', gradeId: 'g10', gradeOrdinal: 10 }
];
const subjects: SubjectRow[] = [
  { id: 'sTOAN', code: 'TOAN', shortName: 'Toán', name: 'Toán học', color: '#DCEAFB' },
  { id: 'sVAN', code: 'VAN', shortName: 'Văn', name: 'Ngữ văn', color: '#FBE0E0' }
];
const configs = [
  { subjectId: 'sTOAN', gradeId: 'g10', periodsPerWeek: 4 },
  { subjectId: 'sVAN', gradeId: 'g10', periodsPerWeek: 3 }
];

test('buildMatrix: chuẩn theo (môn|khối), Tổng lớp, Tổng môn, pool sắp tải tăng', () => {
  const assignments: RawAssignment[] = [
    { assignmentId: 'a1', subjectId: 'sTOAN', classId: 'cA', periodsPerWeek: 4, teacherIds: ['t1'] },
    { assignmentId: 'a2', subjectId: 'sVAN', classId: 'cA', periodsPerWeek: 4, teacherIds: ['t2'] }, // thừa +1 so chuẩn 3
    { assignmentId: 'a3', subjectId: 'sTOAN', classId: 'cB', periodsPerWeek: 4, teacherIds: ['t1'] },
    // Ghép lớp: a4 dạy chung cA+cB — hai dòng cùng assignmentId
    { assignmentId: 'a4', subjectId: 'sVAN', classId: 'cA', periodsPerWeek: 1, teacherIds: ['t3'] },
    { assignmentId: 'a4', subjectId: 'sVAN', classId: 'cB', periodsPerWeek: 1, teacherIds: ['t3'] }
  ];
  const pool: PoolRow[] = [
    { id: 't3', name: 'Lê C', short: 'C.Lê', maxPeriods: 19, assigned: 2, subjectIds: ['sVAN'] },
    { id: 't1', name: 'Nguyễn A', short: 'A.Nguyễn', maxPeriods: 19, assigned: 8, subjectIds: ['sTOAN'] },
    { id: 't2', name: 'Trần B', short: 'B.Trần', maxPeriods: 19, assigned: 4, subjectIds: ['sVAN'] }
  ];

  const m = buildMatrix({ classes, subjects, assignments, configs, teacherPool: pool });

  assert.equal(m.standards['sTOAN|g10'], 4);
  const cATotals = m.totals.byClass.find((x) => x.classId === 'cA')!;
  assert.equal(cATotals.assigned, 9);   // 4+4+1
  assert.equal(cATotals.standard, 7);   // 4+3
  const toanTotal = m.totals.bySubject.find((x) => x.subjectId === 'sTOAN')!;
  assert.equal(toanTotal.periods, 8);
  // Ghép lớp giữ nguyên assignmentId ở cả hai ô
  const vanCells = m.cells.filter((x) => x.assignmentId === 'a4');
  assert.equal(vanCells.length, 2);

  // Pool: tải tăng dần — dropdown chọn GV đúng thứ tự §7
  assert.deepEqual(m.teacherPool.map((p) => p.id), ['t3', 't2', 't1']);
});

test('planApply: create / update_ppw / update_teachers / delete đúng tối thiểu', () => {
  const existing = [
    { assignmentId: 'a1', subjectId: 'sTOAN', classId: 'cA', periodsPerWeek: 4, teacherIds: ['t1'] },
    { assignmentId: 'a0', subjectId: 'sVAN', classId: 'cA', periodsPerWeek: 3, teacherIds: ['t2'] }
  ];
  const qualified = new Map([['sTOAN', new Set(['t1'])], ['sVAN', new Set(['t2'])]]);

  const r = planApply(existing, qualified, [
    // Ô mới
    { classId: 'cB', subjectId: 'sTOAN', periodsPerWeek: 4, teacherIds: ['t1'] },
    // Đổi số tiết của ô đã có
    { classId: 'cA', subjectId: 'sTOAN', periodsPerWeek: 5, teacherIds: ['t1'] },
    // Chỉ đổi GV -> một op update_teachers, KHÔNG đụng ppw
    { classId: 'cA', subjectId: 'sTOAN', periodsPerWeek: 4, teacherIds: ['t9'] },
    // Xoá rõ ràng bằng 0
    { classId: 'cA', subjectId: 'sVAN', periodsPerWeek: 0, teacherIds: [] }
  ]);

  const kinds = r.ops.map((o) => o.kind).sort();
  assert.ok(kinds.includes('create'));
  assert.ok(kinds.includes('update_ppw'));
  assert.ok(kinds.includes('update_teachers'));
  assert.ok(kinds.includes('delete'));
});

test('planApply: không thay đổi nếu trùng khớp; cảnh báo GV thiếu chuyên môn; dedupe', () => {
  const existing = [
    { assignmentId: 'a1', subjectId: 'sTOAN', classId: 'cA', periodsPerWeek: 4, teacherIds: ['t1'] }
  ];
  const qualified = new Map([
    ['sTOAN', new Set(['t1'])],
    ['sVAN', new Set(['t2'])]   // t1 KHÔNG dạy Văn -> phải cảnh báo
  ]);

  const noChange = planApply(existing, qualified, [
    { classId: 'cA', subjectId: 'sTOAN', periodsPerWeek: 4, teacherIds: ['t1'] }
  ]);
  assert.equal(noChange.ops.length, 0);

  const warn = planApply(existing, qualified, [
    { classId: 'cA', subjectId: 'sVAN', periodsPerWeek: 3, teacherIds: ['t1'] }, // t1 không dạy Văn
    { classId: 'cA', subjectId: 'sVAN', periodsPerWeek: 3, teacherIds: ['t1'] }  // trùng trong request
  ]);
  assert.ok(warn.warnings.some((w) => w.kind === 'TEACHER_NOT_QUALIFIED'));
  assert.ok(warn.warnings.some((w) => w.kind === 'DUPLICATE_IN_REQUEST'));
});
