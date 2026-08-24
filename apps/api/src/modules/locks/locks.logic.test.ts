import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAcquire, isSilent, canTakeover, LOCK_TTL_MS } from './locks.logic.ts';

const NOW = 1_800_000_000_000;
const ctx = (userId: string, role: any) => ({ userId, role, now: NOW });

function lock(classId: string, userId: string, opts: Partial<{userName:string; expiresIn:number; silentFor:number}> = {}) {
  return {
    classId,
    userId,
    userName: opts.userName ?? 'C.Mai',
    expiresAt: NOW + (opts.expiresIn ?? LOCK_TTL_MS),
    lastWriteAt: NOW - (opts.silentFor ?? 0)
  };
}

test('Xin khoá trống: được toàn bộ; khoá người khác còn hạn: bị từ chối', () => {
  const r1 = evaluateAcquire([], ['c1', 'c2'], ctx('u1', 'scheduler'));
  assert.deepEqual(r1.granted.sort(), ['c1', 'c2']);
  assert.equal(r1.denied.length, 0);

  const existing = [lock('c1', 'u2', { expiresIn: 30_000 })];
  const r2 = evaluateAcquire(existing, ['c1', 'c3'], ctx('u1', 'scheduler'));
  assert.deepEqual(r2.granted, ['c3']);           // cấp từng phần
  assert.equal(r2.denied.length, 1);
  assert.equal(r2.denied[0].classId, 'c1');
  assert.equal(r2.denied[0].userName, 'C.Mai');
});

test('Khoá hết hạn coi như trống', () => {
  const existing = [lock('c1', 'u2', { expiresIn: -1_000 })];
  const r = evaluateAcquire(existing, ['c1'], ctx('u1', 'teacher'));
  assert.deepEqual(r.granted, ['c1']);
});

test('Khoá của chính mình -> granted (re-acquire gia hạn TTL)', () => {
  const existing = [lock('c1', 'u-me')];
  const r = evaluateAcquire(existing, ['c1'], ctx('u-me', 'scheduler'));
  assert.deepEqual(r.granted, ['c1']);
});

test('Takeover: owner/admin luôn được; scheduler chỉ khi im lặng >5 phút', () => {
  const fresh = lock('c1', 'u2', { silentFor: 60_000 });      // mới ghi 1 phút trước
  const stale = lock('c2', 'u2', { silentFor: 6 * 60_000 }); // im lặng 6 phút

  assert.equal(canTakeover('admin', fresh, NOW), true);
  assert.equal(canTakeover('owner', fresh, NOW), true);
  assert.equal(canTakeover('scheduler', fresh, NOW), false);
  assert.equal(canTakeover('scheduler', stale, NOW), true);
  assert.equal(isSilent(stale, NOW), true);

  const r = evaluateAcquire([fresh, stale], ['c1', 'c2'], ctx('u-sched', 'scheduler'), true);
  assert.deepEqual(r.granted, ['c2']);            // chỉ giành được khoá im lặng
  assert.equal(r.denied[0].classId, 'c1');
});

test('Teacher/viewer không bao giờ takeover dù im lặng lâu', () => {
  const stale = lock('c1', 'u2', { silentFor: 30 * 60_000 });
  assert.equal(canTakeover('teacher', stale, NOW), false);
  assert.equal(canTakeover('viewer', stale, NOW), false);
});
