import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPersistStatements, PERSIST_ORDER } from './persist.ts';
import type { PersistInput } from './persist.ts';

const input: PersistInput = {
  timetableId: '11111111-1111-1111-1111-111111111111',
  schoolId: '22222222-2222-2222-2222-222222222222',
  softScore: 214,
  snapshotPayload: { slots: [0, 5, -1] },
  writes: [
    { assignmentId: 'aaaaaaaa-0000-0000-0000-000000000001', subjectId: 'sTOAN', dayOfWeek: 2, periodId: 'p1', classIds: ['cA'], teacherIds: ['t1'] },
    { assignmentId: 'aaaaaaaa-0000-0000-0000-000000000002', subjectId: 'sVAN', dayOfWeek: 3, periodId: 'p2', classIds: ['cA', 'cB'], teacherIds: ['t2'] }
  ]
};

test('Thứ tự statement đúng solver spec §12.3: snapshot trước, update sau cùng', () => {
  const stmts = buildPersistStatements(input);
  assert.deepEqual(stmts.map((s) => s.name), [...PERSIST_ORDER]);
});

test('DELETE chỉ xoá tiết CHƯA ghim', () => {
  const del = buildPersistStatements(input).find((s) => s.name === 'delete')!;
  assert.match(del.text, /is_pinned = false/);
  assert.deepEqual(del.values, [input.timetableId]);
});

test('insert_lessons dùng unnest — 153 tiết là MỘT statement không phải 153', () => {
  const ins = buildPersistStatements(input).find((s) => s.name === 'insert_lessons')!;
  assert.match(ins.text, /unnest\(/);
  assert.equal(ins.values.length, 6);
  // params mảng song song dài bằng số write
  assert.equal((ins.values[2] as unknown[]).length, input.writes.length);
  assert.equal((ins.values[3] as unknown[]).length, input.writes.length);
});

test('children: số cặp class/teacher khớp tổng khai báo', () => {
  const stmts = buildPersistStatements(input);
  const cls = stmts.find((s) => s.name === 'insert_classes')!;
  const tea = stmts.find((s) => s.name === 'insert_teachers')!;
  // writes có 3 cặp lớp (1+2) và 2 cặp GV (1+1)
  assert.equal((cls.values[1] as unknown[]).length, 3);
  assert.equal((tea.values[1] as unknown[]).length, 2);
  assert.match(cls.text, /lesson_classes/);
  assert.match(tea.text, /lesson_teachers/);
  assert.ok(!cls.text.includes('is_pinned'));
});

test('update_tt set status ready + soft_score; KHÔNG đụng version (trigger lo)', () => {
  const upd = buildPersistStatements(input).find((s) => s.name === 'update_tt')!;
  assert.match(upd.text, /status = 'ready'/);
  assert.match(upd.text, /soft_score = \$2/);
  assert.ok(!upd.text.toLowerCase().includes('version'));
});
