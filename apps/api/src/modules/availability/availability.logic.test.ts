import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSlots, diffSlots, slotKey } from './availability.logic.ts';

const PERIODS = new Set(['p1', 'p2', 'p3']);

test('validateSlots: chặn dayOfWeek/periodId/preference sai; khử trùng lặp', () => {
  const r = validateSlots(PERIODS, [
    { dayOfWeek: 2, periodId: 'p1', preference: 'busy' },          // OK
    { dayOfWeek: 8, periodId: 'p1', preference: 'busy' },          // dow sai
    { dayOfWeek: 3, periodId: 'p9', preference: 'busy' },          // period lạ
    { dayOfWeek: 3, periodId: 'p1', preference: 'free' },          // pref sai
    { dayOfWeek: 4, periodId: 'p2', preference: 'avoid', isRecurring: true },
    { dayOfWeek: 4, periodId: 'p2', preference: 'available' }      // trùng -> dùng cuối
  ]);

  // 3 ô sai + 1 ô trùng (trùng cũng được báo, giá trị cuối thắng)
  assert.equal(r.issues.length, 4);
  const last = r.clean.find((s) => s.dayOfWeek === 4)!;
  assert.equal(last.preference, 'available');                      // giá trị cuối thắng
  assert.equal(last.isRecurring, false);
});

test('diffSlots: insert/update/delete tối thiểu cho PUT ghi đè toàn bộ', () => {
  const existing = [
    { dayOfWeek: 2, periodId: 'p1', preference: 'busy' },          // giữ nguyên
    { dayOfWeek: 2, periodId: 'p2', preference: 'busy' },          // đổi pref
    { dayOfWeek: 3, periodId: 'p1', preference: 'preferred' }      // bị bỏ -> xoá
  ];
  const desired = [
    { dayOfWeek: 2, periodId: 'p1', preference: 'busy' },
    { dayOfWeek: 2, periodId: 'p2', preference: 'avoid' },
    { dayOfWeek: 5, periodId: 'p3', preference: 'available' }      // mới
  ];
  const d = diffSlots(existing, desired);

  assert.deepEqual(d.insert.map((x) => slotKey(x)), ['5|p3']);
  assert.deepEqual(d.update.map((x) => slotKey(x)), ['2|p2']);
  assert.deepEqual(d.deleteKeys, ['3|p1']);
});

test('isRecurring khác cũng tính là update (rollover cần phân biệt)', () => {
  const d = diffSlots(
    [{ dayOfWeek: 6, periodId: 'p1', preference: 'busy', isRecurring: false }],
    [{ dayOfWeek: 6, periodId: 'p1', preference: 'busy', isRecurring: true }]
  );
  assert.equal(d.update.length, 1);
  assert.equal(d.insert.length, 0);
});
