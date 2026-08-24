import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CATALOG, pickColumns, validatePayload, validateBulkItems,
  validateGradeConfigs, validateTeacherSubjects
} from './catalog.schema.ts';

test('Registry phủ đủ 6 resource với bảng DB đúng', () => {
  const expected = ['grades', 'departments', 'subjects', 'rooms', 'teachers', 'classes'];
  assert.deepEqual(Object.keys(CATALOG).sort(), [...expected].sort());
  assert.equal(CATALOG.teachers.table, 'teachers');
  assert.equal(CATALOG.classes.required.includes('grade_id'), true);
});

test('pickColumns: CHẶN ghi đè school_id / school_year_id / id từ body', () => {
  const body = {
    name: '10A1', ordinal: 1,
    school_id: 'hacker-school', school_year_id: 'hacker-year', id: 'hacker-id',
    evil: 'anything'
  };
  const picked = pickColumns(CATALOG.grades, body);
  assert.equal(picked.name, '10A1');
  assert.equal('school_id' in picked, false);
  assert.equal('school_year_id' in picked, false);
  assert.equal('id' in picked, false);
  assert.equal('evil' in picked, false);
});

test('validatePayload create: bắt thiếu required; patch bỏ qua required', () => {
  const issues = validatePayload(CATALOG.teachers, { email: 'x@y.vn' }, { create: true });
  assert.ok(issues.some((i) => i.field === 'code'));
  assert.ok(issues.some((i) => i.field === 'full_name'));

  const patch = validatePayload(CATALOG.teachers, { max_periods_per_week: 19 }, { create: false });
  assert.equal(patch.length, 0);
});

test('validatePayload: enum sai bị chặn, đúng thì qua; số dạng chuỗi được coerce', () => {
  const bad = validatePayload(CATALOG.rooms, { code: 'R1', name: 'Phòng', kind: 'spaceship' }, { create: true });
  assert.ok(bad.some((i) => i.field === 'kind' && /spaceship/.test(i.message)));

  const ok = validatePayload(CATALOG.rooms, { code: 'R1', name: 'Phòng máy', kind: 'computer', capacity: '40' }, { create: true });
  assert.equal(ok.length, 0);
});

test('validatePayload: difficulty ngoài 1–5 bị chặn; uuid sai bị chặn', () => {
  const d = validatePayload(CATALOG.subjects,
    { code: 'T', name: 'Toán', difficulty: 9 }, { create: true });
  assert.ok(d.some((i) => i.field === 'difficulty'));

  const u = validatePayload(CATALOG.classes,
    { name: 'X', grade_id: 'khong-phai-uuid' }, { create: true });
  assert.ok(u.some((i) => i.field === 'grade_id'));
});

test('validateBulkItems: báo lỗi kèm index; op update bắt buộc id', () => {
  const errs = validateBulkItems(CATALOG.grades, [
    { op: 'create', data: { name: 'Khối 10', ordinal: '1' } },   // OK
    { op: 'delete', data: {} },                                   // op không hỗ trợ
    { op: 'update', data: { name: 'X' } },                        // thiếu id
    { op: 'create', data: {} }                                    // thiếu name
  ]);
  assert.deepEqual(errs.map((e) => e.index), [1, 2, 3]);
});

test('validateGradeConfigs + validateTeacherSubjects', () => {
  const g = validateGradeConfigs([{ gradeOrdinal: 10, periodsPerWeek: '4' }, { gradeOrdinal: 11, periodsPerWeek: 30 }]);
  assert.equal(g.ok, false);
  if (!g.ok) assert.equal(g.issues.length, 1); // 30 > 20

  const gOk = validateGradeConfigs([{ gradeOrdinal: 12, periodsPerWeek: 4 }]);
  assert.equal(gOk.ok, true);

  const tBad = validateTeacherSubjects(['abc']);
  assert.equal(tBad.ok, false);

  const tOk = validateTeacherSubjects([
    '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111' // trùng -> khử
  ]);
  assert.equal(tOk.ok, true);
  if (tOk.ok) assert.equal(tOk.subjectIds.length, 1);
});
