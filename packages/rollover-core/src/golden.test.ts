import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoteClassName, mapClasses, mapAssignments } from './index.ts';
import type { OldClass, OldAssignment, NewClass } from './index.ts';

/* ================= Ánh xạ lớp (§4) ================= */

const oldClasses: OldClass[] = [
  { id: 'c10a1', name: '10A1', gradeOrdinal: 10, homeroomTeacherId: 't1' },
  { id: 'c10a2', name: '10A2', gradeOrdinal: 10 },
  { id: 'c11a1', name: '11A1', gradeOrdinal: 11 },
  { id: 'c12a1', name: '12A1', gradeOrdinal: 12 },
  { id: 'chuyen', name: 'Chuyên Toán 1', gradeOrdinal: 10 }
];

test('promoteClassName: suy đúng; khoảng trắng thừa được tha thứ (§3.3)', () => {
  assert.equal(promoteClassName('10A1', 10, 11), '11A1');
  // Dấu cách thừa giữa số và chữ là nhiễu phổ biến trong file thật -> vẫn suy được
  assert.equal(promoteClassName('10 A1', 10, 11), '11A1');
  assert.equal(promoteClassName('Chuyên Toán 1', 10, 11), null);
  assert.equal(promoteClassName('9A1', 10, 11), null);
});

test('mapClasses: graduate / promote / tuyển mới theo mẫu #', () => {
  const maps = mapClasses(oldClasses, {
    span: { first: 10, last: 12 },
    intake: { gradeOrdinal: 10, count: 3, namePattern: '10A#' }
  });
  const g12 = maps.filter((m) => m.action === 'graduate');
  assert.equal(g12.length, 1);

  const promoted = maps.filter((m) => m.action === 'promote' && m.auto);
  assert.ok(promoted.some((m) => m.sourceId === 'c11a1' && m.targetName === '12A1'));
  // c10a1 promote nhưng khối 10 bị intake chiếm? — không: intake chỉ TẠO MỚI,
  // khối cũ vẫn promote bình thường khi không nằm trong shuffleGrades
  assert.ok(promoted.some((m) => m.sourceId === 'c10a1' && m.targetName === '11A1'));

  // 'Chuyên Toán 1' không suy được -> auto=false bắt điền tay
  const manual = maps.find((m) => m.sourceId === 'chuyen');
  assert.equal(manual!.action, 'promote');
  assert.equal(manual!.auto, false);
  assert.equal(manual!.targetName, null);

  // Tuyển mới tạo đúng 3 lớp theo mẫu
  const created = maps.filter((m) => m.action === 'create');
  assert.deepEqual(created.map((m) => m.targetName).sort(), ['10A1', '10A2', '10A3']);
});

test('mapClasses: khối xáo trộn skip + createCounts thay thế', () => {
  const maps = mapClasses(oldClasses.map((c) => ({ ...c })), {
    span: { first: 10, last: 12 },
    shuffleGrades: [10],
    createCounts: [{ gradeOrdinal: 11, count: 2, namePattern: '11X#' }]
  });
  const skipped = maps.filter((m) => m.action === 'skip');
  assert.equal(skipped.length, 3); // cả 3 lớp khối 10 (gồm Chuyên Toán 1)
  assert.ok(skipped.every((m) => m.note!.includes('xáo trộn')));
  const created = maps.filter((m) => m.action === 'create' && m.gradeOrdinal === 11);
  assert.deepEqual(created.map((m) => m.targetName).sort(), ['11X1', '11X2']);
});

/* ================= Phân công (§6) ================= */

// Năm cũ: khối 10 hai lớp; năm mới: 10->11 promote, tuyển 10 mới
const OC = [
  { id: 'old10a', gradeOrdinal: 10 },
  { id: 'old10b', gradeOrdinal: 10 }
];
const NC: NewClass[] = [
  { id: 'new11a', name: '11A1', gradeOrdinal: 11, sourceId: 'old10a' },
  { id: 'new10a', name: '10M1', gradeOrdinal: 10, sourceId: null }
];
const CONFIGS = [
  { subjectId: 'TOAN', gradeOrdinal: 11, periodsPerWeek: 3 }, // đổi so với cũ 4
  { subjectId: 'TOAN', gradeOrdinal: 10, periodsPerWeek: 4 }
];

test('followClass: GV theo lớp lên, số tiết lấy từ cấu hình khối MỚI', () => {
  const old: OldAssignment[] = [
    { id: 'as1', subjectId: 'TOAN', classId: 'old10a', teacherId: 't1' }
  ];
  const r = mapAssignments(old, OC, NC, CONFIGS, new Set(['TOAN']), { mode: 'followClass' });
  assert.equal(r.assignments.length, 1);
  const a = r.assignments[0];
  assert.equal(a.newClassId, 'new11a');       // lớp lên cùng GV
  assert.equal(a.teacherId, 't1');
  assert.equal(a.periodsPerWeek, 3);          // KHÔNG phải 4 của năm cũ (§6.1)
});

test('keepGrade: GV giữ khối — dạy lứa mới cùng khối', () => {
  const old: OldAssignment[] = [
    { id: 'as2', subjectId: 'TOAN', classId: 'old10b', teacherId: 't2' }
  ];
  const r = mapAssignments(old, OC, NC, CONFIGS, new Set(['TOAN']),
    { mode: 'keepGrade' });
  assert.equal(r.assignments[0].newClassId, 'new10a'); // khối 10 mới
  assert.equal(r.assignments[0].teacherId, 't2');
});

test('GV nghỉ: bỏ GV + cảnh báo RETIRED; môn biến mất: SUBJECT_GONE', () => {
  const old: OldAssignment[] = [
    { id: 'as3', subjectId: 'TOAN', classId: 'old10a', teacherId: 't-retired' },
    { id: 'as4', subjectId: 'SUDIA', classId: 'old10a', teacherId: 't1' }
  ];
  const r = mapAssignments(old, OC, NC, CONFIGS, new Set(['TOAN']),
    { mode: 'followClass', retiredTeacherIds: new Set(['t-retired']) });

  const a3 = r.assignments.find((a) => a.sourceAssignmentId === 'as3')!;
  assert.equal(a3.teacherId, null);
  assert.ok(r.warnings.some((w) => w.kind === 'RETIRED_TEACHER'));
  assert.ok(r.warnings.some((w) => w.kind === 'SUBJECT_GONE' && w.refs?.subjectId === 'SUDIA'));
  assert.ok(!r.assignments.some((a) => a.subjectId === 'SUDIA'));
});

test('Lớp thiếu môn (CLASS_MISSING_SUBJECT) + vượt định mức (OVER_LIMIT)', () => {
  const old: OldAssignment[] = [
    { id: 'as5', subjectId: 'TOAN', classId: 'old10a', teacherId: 't1' },
    { id: 'as6', subjectId: 'TOAN', classId: 'old10b', teacherId: 't1' }
  ];
  const NC2: NewClass[] = [
    ...NC,
    { id: 'new11b', name: '11A2', gradeOrdinal: 11, sourceId: 'old10b' }
  ];
  const r = mapAssignments(old, OC, NC2, CONFIGS, new Set(['TOAN']),
    { mode: 'followClass', limits: new Map([['t1', 5]]) });

  // Cả hai lớp đều được map -> t1 mang 2 phân công x 3 tiết = 6 > định mức 5
  assert.equal(r.assignments.length, 2);
  assert.ok(r.warnings.some((w) =>
    w.kind === 'OVER_LIMIT' && (w.refs as any).teacherId === 't1'),
    't1 mang 6 tiết > định mức 5');

  // new10a (khối tuyển mới, không có nguồn) không được cover môn TOAN
  assert.ok(r.warnings.some((w) =>
    w.kind === 'CLASS_MISSING_SUBJECT' && w.refs?.classId === 'new10a'));
});
