import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKey, normalizePhone, stripTitle, parseGender, parseYesNo,
  parseIntCell, isTotalRow, isEmptyRow,
  matchColumn, mapColumns, findHeaderRow, detectMatrixLayout,
  buildTeacherMatcher, validateTeachers, validateClasses, validateAssignments
} from './index.ts';

/* ================= Chuẩn hoá giá trị (§3.3) ================= */

test('stripTitle: bỏ Thầy/GV. đúng quy tắc hai từ, suy giới tính', () => {
  assert.deepEqual(stripTitle('Thầy Nguyễn Văn Hùng'),
    { name: 'Nguyễn Văn Hùng', gender: 'Nam', stripped: true });
  // "Cô Mai" chỉ còn 1 từ sau chức danh -> KHÔNG bỏ (Cô có thể là tên)
  const r = stripTitle('Cô Mai');
  assert.equal(r.name, 'Cô Mai');
  assert.equal(r.stripped, false);
  assert.equal(r.gender, 'Nữ');
  assert.equal(stripTitle('GV. Sơn').name, 'Sơn');
  assert.equal(stripTitle('GV. Sơn').stripped, true);
});

test('normalizePhone: 3 dạng đầu vào đều về chuẩn 0XXXXXXXXX', () => {
  assert.equal(normalizePhone('0912.345.678'), '0912345678');
  assert.equal(normalizePhone('+84912345678'), '0912345678');
  assert.equal(normalizePhone('912345678'), '0912345678');
  assert.equal(normalizePhone('abc'), null);
});

test('parseGender / parseYesNo / parseIntCell / dòng tổng & dòng trống', () => {
  assert.equal(parseGender('nam'), 'Nam');
  assert.equal(parseGender('Nữ'), 'Nữ');
  assert.equal(parseGender('M'), 'Nam');
  assert.equal(parseYesNo('x'), true);
  assert.equal(parseYesNo('✓'), true);
  assert.equal(parseYesNo('không'), false);
  assert.equal(parseIntCell('4 tiết'), 4);
  assert.equal(parseIntCell('4t'), 4);
  assert.equal(parseIntCell(4.0), 4);
  assert.ok(isTotalRow(['Tổng cộng', '']));
  assert.ok(!isTotalRow(['10A1']));
  assert.ok(isEmptyRow(['', null, '   ']));
});

/* ================= Ánh xạ cột (§3.2) ================= */

test('matchColumn: từ điển đồng nghĩa sheet giáo viên', () => {
  assert.equal(matchColumn('Họ và tên', 'teachers'), 'full_name');
  assert.equal(matchColumn('Mã GV', 'teachers'), 'code');
  assert.equal(matchColumn('Tổ bộ môn', 'teachers'), 'department');
  assert.equal(matchColumn('Số tiết tối đa/tuần', 'teachers'), 'max_periods');
  assert.equal(matchColumn('Điện thoại', 'teachers'), 'phone');
  assert.equal(matchColumn('Ghi chú linh tinh', 'teachers'), null);
});

test('findHeaderRow: lội qua 6 dòng quốc hiệu/tên trường', () => {
  const rows: unknown[][] = [
    ['CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'],
    ['Độc lập - Tự do - Hạnh phúc'],
    ['TRƯỜNG THPT NGUYỄN ĐÌNH CHIỂU'],
    [],
    ['Danh sách giáo viên năm học 2026-2027'],
    ['Người lập: Văn thư'],
    [],
    ['STT', 'Họ và tên', 'Mã GV', 'Tổ bộ môn', 'Môn dạy được', 'Số tiết tối đa/tuần']
  ];
  assert.equal(findHeaderRow(rows, 'teachers'), 7);
});

test('mapColumns: đánh dấu cột không nhận diện để UI cho gán tay', () => {
  const mapped = mapColumns(['Mã GV', 'Họ và tên', 'Ghi chú'], 'teachers');
  assert.equal(mapped[0].field, 'code');
  assert.equal(mapped[1].field, 'full_name');
  assert.equal(mapped[2].field, null);
});

/* ================= Ma trận Lớp × Môn (§2.5) ================= */

test('detectMatrixLayout: nhận dạng ma trận theo danh sách môn đã khai báo', () => {
  const rows = [
    ['BẢNG PHÂN CÔNG GIẢNG DẠY'],
    [],
    ['Lớp \\ Môn', 'Toán học', 'Ngữ văn', 'Tiếng Anh'],
    ['10A1', 'Nguyễn Văn Hùng', 'Trần Thị Mai', 'Phạm Thu Hà']
  ];
  assert.equal(detectMatrixLayout(rows,
    [{ name: 'Toán học' }, { name: 'Ngữ văn' }, { name: 'Tiếng Anh' }]), 2);
  assert.equal(detectMatrixLayout([['a']], [{ name: 'Toán học' }]), -1);
});

/* ================= So khớp tên GV (§3.4) ================= */

const matcher = buildTeacherMatcher([
  { code: 'GV001', name: 'Nguyễn Văn Hùng' },
  { code: 'GV002', name: 'Trần Thị Mai' },
  { code: 'GV003', name: 'Nguyễn Văn Hùng' }  // trùng tên cố ý
]);

test('matchTeacher: mã chính xác thắng mọi thứ; trùng tên báo ambiguous', () => {
  assert.equal(matcher.match('gv001').kind, 'code');
  assert.equal(matcher.match('Trần Thị Mai').kind, 'exact');
  const amb = matcher.match('nguyen van hung');
  assert.equal(amb.kind, 'ambiguous');
  if (amb.kind === 'ambiguous') assert.equal(amb.candidates.length, 2);
});

test('matchTeacher: gợi ý sai chính tả Levenshtein <=2, KHÔNG tự chấp nhận', () => {
  const s = matcher.match('Trần Thị Maii');
  assert.equal(s.kind, 'suggest');
  if (s.kind === 'suggest') {
    assert.equal(s.suggestion.code, 'GV002');
    assert.ok(s.distance >= 1);
  }
});

/* ================= Luật kiểm tra (§4) ================= */

test('validateTeachers: thiếu tên=error, định mức lạ=warning, trùng tên=info', () => {
  const issues = validateTeachers([
    { row: 12, fullName: '', code: 'GV001' },
    { row: 13, fullName: 'A', code: 'GV001' },
    { row: 14, fullName: 'A', code: 'GV001' },
    { row: 15, fullName: 'Nguyễn Văn Hùng', code: 'GV010', maxPeriods: 45 },
    { row: 16, fullName: 'Có Email Sai', code: 'GV011', email: 'sai-email' }
  ], { existingCodes: ['GV999'] });

  assert.ok(issues.some((i) => i.level === 'error' && i.row === 12 && /thiếu họ tên/.test(i.message)));
  assert.ok(issues.some((i) => i.level === 'error' && /trùng mã GV001 trong file/.test(i.message)));
  assert.ok(issues.some((i) => i.level === 'warning' && /định mức 45/.test(i.message)));
  assert.ok(issues.some((i) => i.level === 'info' && /nên đặt mã GV/.test(i.message)));
  assert.ok(issues.some((i) => i.level === 'warning' && /email không đúng/.test(i.message)));
});

test('validateClasses: khối suy được từ tên; GVCN phải tồn tại; chủ nhiệm 2 lớp cảnh báo', () => {
  const teachers = new Set(['nguyễn văn hùng']);
  const issues = validateClasses([
    { row: 2, name: '10A1', grade: 10, homeroomTeacherName: 'Nguyễn Văn Hùng', size: 42 },
    { row: 3, name: 'Chuyên Toán 1', size: 30, homeroomTeacherName: 'Nguyễn Văn Hùng' },
    { row: 4, name: '10A2', grade: 10, homeroomTeacherName: 'Không Tồn Tại' }
  ], teachers);

  assert.ok(issues.some((i) => i.row === 3 && i.level === 'error' && /không xác định được khối/.test(i.message)));
  assert.ok(issues.some((i) => i.row === 4 && i.level === 'error' && /Không tìm thấy giáo viên "Không Tồn Tại"/.test(i.message)));
  assert.ok(issues.some((i) => i.level === 'warning' && /chủ nhiệm 2 lớp/.test(i.message)));
});

test('validateAssignments: đủ các luật chính của §4.3', () => {
  const ctx = {
    classNames: new Set(['10A1', '10A2']),
    subjectNames: new Set(['Toán', 'Văn']),
    teacherMatcher: buildTeacherMatcher([{ code: 'GV001', name: 'Nguyễn Văn Hùng' }]),
    frameSlotsPerClass: 30,
    teacherLimits: new Map([['nguyễn văn hùng', 19]]),
    standardPeriodsBySubject: new Map([['toán', 4]])
  };
  const issues = validateAssignments([
    { row: 10, className: '10A9', subject: 'Toán', teacherName: 'Nguyễn Văn Hùng', periodsPerWeek: 4 },
    { row: 11, className: '10A1', subject: 'Toán', teacherName: 'Nguyễn Văn Hùng', periodsPerWeek: 4 },
    { row: 12, className: '10A1', subject: 'Toán', teacherName: 'Nguyễn Văn Hùng', periodsPerWeek: 3 }, // trùng + lệch chuẩn
    { row: 13, className: '10A2', subject: 'Văn', teacherName: 'Nguyễn Văn Hùng', periodsPerWeek: 25 },
    { row: 14, className: '10A2', subject: 'Văn', teacherName: 'Ai Đó Không Có', periodsPerWeek: 2 },
    { row: 15, className: '10A1', subject: 'Văn', teacherName: 'Nguyễn Văn Hùng', periodsPerWeek: 0 }
  ], ctx);

  assert.ok(issues.some((i) => i.row === 10 && /không có lớp "10A9"/.test(i.message)));
  assert.ok(issues.some((i) => i.row === 12 && /bị phân công hai lần/.test(i.message)));
  assert.ok(issues.some((i) => i.row === 12 && /chuẩn là 4 tiết, file ghi 3/.test(i.message)));
  assert.ok(issues.some((i) => /vượt định mức 19/.test(i.message)), 'cảnh báo GV vượt định mức');
  assert.ok(issues.some((i) => i.row === 14 && /không tìm thấy giáo viên "Ai Đó Không Có"/.test(i.message)));
  assert.ok(issues.some((i) => i.row === 15 && /số tiết phải > 0/.test(i.message)));
  // Tổng tiết 10A1 = 4+3+0 = 7 <= 30 -> không lỗi khung
  assert.ok(!issues.some((i) => /khung chỉ có 30 ô/.test(i.message)));
});
