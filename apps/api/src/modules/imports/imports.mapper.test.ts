import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDbValues } from './imports.mapper.ts';
import { buildTeacherMatcher, validateTeachers } from '@tkb/import-core';

test('toDbValues: chuẩn hoá đúng chuỗi bừa bộn của file thật', () => {
  const v = toDbValues({
    row: 12,
    values: {
      full_name: 'Thầy Nguyễn Văn Hùng',
      code: ' gv001 ',
      gender: '',
      email: ' Hung@Truong.VN ',
      phone: '+84912.345.678',
      max_periods: '19 tiết'
    }
  });
  assert.equal(v.fullName, 'Nguyễn Văn Hùng');
  assert.equal(v.gender, 'Nam');            // suy từ chức danh Thầy
  assert.equal(v.code, 'gv001');
  assert.equal(v.phone, '0912345678');
  assert.equal(v.maxPeriods, 19);
});

test('toDbValues: Cô + 1 từ KHÔNG bỏ chức danh nhưng ghi Nữ (§3.3)', () => {
  const v = toDbValues({ row: 13, values: { full_name: 'Cô Mai' } });
  assert.equal(v.fullName, 'Cô Mai');
  assert.equal(v.gender, 'Nữ');
});

test('validateTeachers qua matcher: trùng tên đầy đủ -> ambiguous info', () => {
  const existing = [
    { code: 'GV001', name: 'Nguyễn Văn Hùng' },
    { code: 'GV045', name: 'Nguyễn Văn Hùng' }
  ];
  const rows = [toDbValues({ row: 20, values: { full_name: 'nguyen van hung', code: 'GV100' } })];
  const issues = validateTeachers(rows);

  // Tên mới không trùng DB vì validateTeachers chỉ nhìn trong file —
  // kiểm tra ambiguous là việc của matcher khi commit (service dùng buildTeacherMatcher)
  const m = buildTeacherMatcher(existing).match('nguyen van hung');
  assert.equal(m.kind, 'ambiguous');
});
