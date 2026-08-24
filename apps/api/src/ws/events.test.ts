import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SeqBuffer, ChannelRegistry, envelope } from './events.ts';

test('SeqBuffer: resume since=N trả đúng phần sau; gap quá xa -> resync', () => {
  const b = new SeqBuffer(3); // capacity nhỏ để ép tình huống hụt
  b.append(1, 'lesson.moved', { i: 1 });
  b.append(2, 'lesson.moved', { i: 2 });
  b.append(3, 'lesson.moved', { i: 3 });

  assert.deepEqual(b.since(0)!.map((x: any) => x.i), [1, 2, 3]); // client chưa có gì
  assert.deepEqual(b.since(1)!.map((x: any) => x.i), [2, 3]);
  assert.equal(b.since(3)!.length, 0);
  assert.equal(b.latest(), 3);

  b.append(4, 'x', { i: 4 });
  // seq1 đã rơi khỏi buffer: client ở since=0 thiếu sự kiện -> buộc resync
  assert.equal(b.since(0), null);
  assert.deepEqual(b.since(1)!.map((x: any) => x.i), [2, 3, 4]); // có đủ từ 2
});

test('ChannelRegistry: seq RIÊNG từng kênh, không lẫn nhau', () => {
  const reg = new ChannelRegistry();
  const s1 = reg.publish('timetable:a', 'lesson.moved', {});
  const s2 = reg.publish('school:x', 'member.joined', {});
  const s3 = reg.publish('timetable:a', 'lock.acquired', {});
  assert.deepEqual([s1, s2, s3], [1, 1, 2]); // kênh school bắt đầu lại từ 1
  assert.equal(reg.channel('timetable:a').latest(), 2);
});

test('envelope: gắn seq/ts/channel + originConnectionId để client tự lọc echo', () => {
  const reg = new ChannelRegistry();
  const e = envelope(reg, 'timetable:c4a1', 'lesson.moved',
    { lessonId: 'l1' },
    { actor: { userId: 'u9', name: 'C.Mai' }, originConnectionId: 'conn_9f3a' });

  assert.equal(e.seq, 1);
  assert.equal(e.channel, 'timetable:c4a1');
  assert.equal(e.originConnectionId, 'conn_9f3a');
  assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T/);
});
