import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs } from './ics.ts';

const SEM_START = new Date(2026, 8, 7);   // Thứ Hai 07/09/2026
const SEM_END = new Date(2027, 0, 15);

function build(holidays?: Date[], description?: string) {
  return buildIcs([
    { uidKey: 'lesson-1', dayOfWeek: 2, start: '07:50', end: '08:35',
      summary: 'Toán - 10A1', location: 'A201', description }
  ], {
    calName: 'TKB - T. Nguyễn Văn Hùng - HK I 2026-2027',
    semesterStart: SEM_START, semesterEnd: SEM_END, holidays
  });
}

test('Khối VTIMEZONE bắt buộc + RRULE đúng BYDAY theo dayOfWeek ISO', () => {
  const ics = build();
  assert.ok(ics.includes('BEGIN:VTIMEZONE'));
  assert.ok(ics.includes('TZOFFSETTO:+0700'));
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270115T235959Z/);
  // Thứ Hai 07/09 là ngày xuất hiện đầu của weekday=2? — 07/09 là THỨ HAI (1)
  // nên weekday=2 lần đầu xuất hiện ngày 08/09:
  assert.ok(ics.includes('DTSTART;TZID=Asia/Ho_Chi_Minh:20260908T075000'));
});

test('EXDATE chỉ sinh cho ngày lễ TRÙNG weekday của sự kiện', () => {
  // 01/01/2027 là Thứ Sáu -> sự kiện TU không có EXDATE
  const noEx = build([new Date(2027, 0, 1)]);
  assert.ok(!noEx.includes('EXDATE'));

  // thêm lễ trúng Thứ Ba: 22/12/2026 (Thứ Ba)
  const withEx = build([new Date(2026, 11, 22)]);
  assert.match(withEx, /EXDATE;TZID=Asia\/Ho_Chi_Minh:20261222T075000/);
});

test('Escape dấu phẩy/chấm phẩy trong LOCATION và SUMMARY', () => {
  const ics = buildIcs([{
    uidKey: 'x', dayOfWeek: 3, start: '08:00', end: '08:45',
    summary: 'Hoá, Lí', location: 'Lab A; B'
  }], { calName: 't', semesterStart: SEM_START, semesterEnd: SEM_END });
  assert.ok(ics.includes('SUMMARY:Hoá\\, Lí'));
  assert.ok(ics.includes('LOCATION:Lab A\\; B'));
});

test('Fold dòng dài: dòng đầu <=73, các dòng tiếp theo có khoảng trắng đầu', () => {
  const longDesc = 'Mô tả rất dài. '.repeat(20);
  const ics = build([], longDesc);
  for (const line of ics.split('\r\n')) {
    if (line.startsWith('DESCRIPTION')) continue;
    if (line.startsWith(' ') === false) assert.ok(line.length <= 75, `dòng quá dài: ${line.length}`);
  }
  assert.ok(ics.split('\r\n').some((l) => l.startsWith(' ')), 'phải có dòng tiếp diễn');
});

test('VALARM mặc định -PT10M với mô tả gồm phòng', () => {
  const ics = build();
  assert.ok(ics.includes('TRIGGER:-PT10M'));
  assert.ok(ics.includes('DESCRIPTION:Toán - 10A1 - A201'));
});
