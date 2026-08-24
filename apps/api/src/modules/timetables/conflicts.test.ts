import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanConflicts } from './conflicts.ts';

test('missing_periods: thiếu tiết báo soft kèm số cụ thể', () => {
  const out = scanConflicts({
    assignments: [{
      assignmentId: 'a1', classId: 'cA', subjectShort: 'Toán',
      className: '10A1', periodsPerWeek: 4, placed: 3
    }],
    busyViolations: [], frameSlots: 30
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'missing_periods');
  assert.equal(out[0].severity, 'soft');
  assert.match(out[0].message, /thiếu 1\/4 tiết/);
});

test('excess_periods: vượt cấu hình = soft; vượt cả khung = hard', () => {
  const out = scanConflicts({
    assignments: [
      { assignmentId: 'a2', classId: 'cA', subjectShort: 'Văn', className: '10A1', periodsPerWeek: 3, placed: 5 },
      { assignmentId: 'a3', classId: 'cB', subjectShort: 'Lí', className: '10A2', periodsPerWeek: 2, placed: 31 }
    ],
    busyViolations: [], frameSlots: 30
  });
  const softExcess = out.find((x) => x.kind === 'excess_periods' && x.severity === 'soft');
  const hardExcess = out.find((x) => x.kind === 'excess_periods' && x.severity === 'hard');
  assert.ok(softExcess, 'vượt cấu hình nhưng trong khung -> soft');
  assert.match(softExcess!.message, /xếp 5 tiết/);
  assert.ok(hardExcess, '31 tiết > khung 30 -> hard');
});

test('constraint_violation: GV khai bận nhưng có tiết -> hard, hard xếp trước', () => {
  const out = scanConflicts({
    assignments: [
      { assignmentId: 'a1', classId: 'cA', subjectShort: 'Toán', className: '10A1', periodsPerWeek: 4, placed: 3 }
    ],
    busyViolations: [{
      lessonId: 'l9', axis: 'teacher', ownerId: 't1', ownerName: 'T.Hùng',
      dayOfWeek: 6, periodLabel: 'Tiết 1', subjectShort: 'Toán'
    }],
    frameSlots: 30
  });

  assert.equal(out[0].kind, 'constraint_violation');   // hard lên đầu
  assert.equal(out[0].severity, 'hard');
  assert.match(out[0].message, /Thứ Bảy/);
  assert.match(out[0].message, /T\.Hùng khai báo bận/);
});
