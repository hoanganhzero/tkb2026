import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSnapshotPayload, validateSnapshotPayload, SNAPSHOT_VERSION
} from './snapshots.logic.ts';

const lessons = [{
  id: '11111111-1111-1111-1111-111111111111',
  assignment_id: 'aaaaaaaa-0000-0000-0000-000000000001',
  subject_id: 'sTOAN',
  day_of_week: 2,
  period_id: 'p1',
  room_id: null,
  is_pinned: false,
  double_group_id: null
}];

test('build -> validate round-trip giữ nguyên dữ liệu', () => {
  const payload = buildSnapshotPayload(lessons, [{ lesson_id: lessons[0].id, other_id: 'cA' }], []);
  const v = validateSnapshotPayload(JSON.parse(JSON.stringify(payload)));
  if (!v.ok) return assert.fail(v.message);
  assert.deepEqual(v.payload.lessons, lessons);
});

test('Từ chối version lạ và payload thiếu trường', () => {
  const bad = validateSnapshotPayload({ v: 99 });
  if (bad.ok) return assert.fail('version 99 phải bị từ chối');
  assert.match(bad.message, /không hỗ trợ/);
  assert.ok(!validateSnapshotPayload({ v: 1 }).ok);
  assert.ok(!validateSnapshotPayload(null).ok);
});

test('SNAPSHOT_VERSION hiện tại = 1', () => {
  assert.equal(SNAPSHOT_VERSION, 1);
});
