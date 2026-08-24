import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildTimetableSchoolXlsx, fromGridPayload } from './xlsx.ts';
import type { GridPayload } from '../../lib/grid-payload.js';

const payload: GridPayload = {
  timetable: { id: 't1', name: 'TKB HK I — seed', status: 'ready', version: 7, softScore: 214, hardViolations: 0 },
  dict: {
    days: [1, 2],
    periods: [
      { id: 'p1', session: 'morning', ordinal: 1, name: 'Tiết 1', start: null, end: null, day_position: 1 },
      { id: 'p2', session: 'morning', ordinal: 2, name: 'Tiết 2', start: null, end: null, day_position: 2 }
    ],
    classes: [{ id: 'cA', name: '10A1' }, { id: 'cB', name: '10A2' }],
    teachers: [{ id: 't1', name: 'Nguyễn Văn Hùng', short: 'T.Hùng' }],
    subjects: [{ id: 'sTOAN', short: 'Toán', name: 'Toán học', color: 0 }],
    rooms: [],
    palette: ['#DCEAFB']
  },
  lessons: {
    count: 2,
    id: ['l1', 'l2'],
    slot: [0, 1],          // 10A1 tiết 1; 10A2 tiết 2
    subject: [0, 0],
    class: [0, 1],
    teacher: [0, 0],
    room: [-1, -1],
    flags: [0, 0]
  }
};

test('fromGridPayload: ô đúng vị trí slot = day*P + pos, kèm màu palette', () => {
  const input = fromGridPayload(payload, { school: 'THPT Demo', appliedFrom: '07/09/2026' });
  assert.equal(input.days.length, 2);
  assert.equal(input.rows[0].cells[0]!.text, 'Toán');
  assert.equal(input.rows[0].cells[0]!.sub, 'T.Hùng');
  assert.equal(input.rows[0].cells[0]!.bg, '#DCEAFB');
  assert.equal(input.rows[1].cells[0], null);   // 10A2 không có tiết slot0
  assert.notEqual(input.rows[1].cells[1], null);
});

test('buildTimetableSchoolXlsx: đọc lại được tiêu đề + nền màu môn', async () => {
  const input = fromGridPayload(payload, { school: 'TRƯỜNG THPT DEMO' });
  const buf = await buildTimetableSchoolXlsx(input);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet('TKB')!;
  assert.ok(ws, 'thiếu sheet TKB');

  assert.equal(ws.getCell(1, 1).value, 'THỜI KHÓA BIỂU — TKB HK I — seed');
  assert.equal(ws.getCell(2, 1).value, 'TRƯỜNG THPT DEMO');

  // Ô đầu tiên của 10A1 có nền màu môn (argb FF + hex)
  const cell = ws.getRow(7).getCell(2);
  const fill = (cell as any).fill;
  assert.equal(fill?.fgColor?.argb, 'FFDCEAFB');
});

test('buildTableXlsx: header tô nền + định dạng có điều kiện cột chênh lệch', async () => {
  const { buildTableXlsx } = await import('./xlsx.ts');
  const buf = await buildTableXlsx({
    title: 'BẢNG TẢI GIẢNG DẠY',
    school: 'THPT Demo',
    headers: ['Họ và tên', 'Tiết/tuần', 'Định mức', 'Chênh lệch'],
    rows: [
      ['Nguyễn Văn Hùng', 23, 19, 4],
      ['Trần Thị Mai', 17, 19, -2]
    ],
    deltaColIndex: 3
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.getWorksheet('Báo cáo')!;
  assert.match(String(ws.getCell(1, 1).value), /TẢI GIẢNG DẠY/);
  assert.equal(ws.getCell(4, 2).value, 'Tiết/tuần');
  assert.equal(ws.getRow(5).getCell(4).value, 4);
});
