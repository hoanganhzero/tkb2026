import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishBlocker, unpublishBlocker, makePublicSlug } from './publish.logic.ts';

test('publishBlocker: chặn khi còn lỗi cứng / đã công bố / lưu trữ', () => {
  assert.equal(publishBlocker({ status: 'ready', hardViolations: 0 }), null);
  assert.match(publishBlocker({ status: 'ready', hardViolations: 3 })!, /3 lỗi ràng buộc cứng/);
  assert.match(publishBlocker({ status: 'published', hardViolations: 0 })!, /đã ở trạng thái công bố/);
  assert.match(publishBlocker({ status: 'archived', hardViolations: 0 })!, /lưu trữ/);
});

test('unpublishBlocker: chỉ gỡ được bản đang published', () => {
  assert.equal(unpublishBlocker('published'), null);
  assert.ok(unpublishBlocker('draft'));
  assert.ok(unpublishBlocker('ready'));
});

test('makePublicSlug: đọc được trường-học-kỳ-năm, rand chống đoán', () => {
  const s = makePublicSlug('thpt-nguyen-dinh-chieu', '2026-2027', 1, 'ab12');
  assert.equal(s, 'thpt-nguyen-dinh-chieu-tkb-2026-2027-hk1-ab12');
  const noSem = makePublicSlug('thcs-demo', '2026-2027', null, 'zz99');
  assert.ok(!noSem.includes('hknull'));
});
