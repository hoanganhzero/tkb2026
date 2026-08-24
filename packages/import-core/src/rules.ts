/**
 * Luật kiểm tra ba mức error/warning/info (excel_import §4).
 * Chỉ mức ERROR chặn dòng. Thông báo là tiếng Việt hiển thị thẳng.
 */
import { isValidEmail } from './normalize.ts';
import { buildTeacherMatcher, type TeacherMatcher } from './match-teacher.ts';

export type IssueLevel = 'error' | 'warning' | 'info';
export interface Issue {
  level: IssueLevel;
  row: number;          // số dòng trong file Excel (1-based, tính cả tiêu đề)
  field?: string;
  message: string;
}

/* ================= Sheet Giáo viên ================= */

export interface TeacherRow {
  row: number;                 // dòng Excel
  fullName: string;
  gender?: 'Nam' | 'Nữ';
  code?: string;
  department?: string;
  subjectsText?: string;
  maxPeriods?: number;
  email?: string;
  phone?: string;
}

export function validateTeachers(
  rows: TeacherRow[],
  ctx: { existingCodes?: string[] } = {},
): Issue[] {
  const issues: Issue[] = [];
  const codeSeen = new Map<string, number>();
  for (const r of rows) {
    if (r.code) codeSeen.set(r.code, (codeSeen.get(r.code) ?? 0) + 1);
  }

  // Đếm trùng mã trong file
  const dupInFile = new Set<string>();
  for (const [c, n] of codeSeen) if (n > 1) dupInFile.add(c);

  const existing = new Set(ctx.existingCodes ?? []);
  const nameCount = new Map<string, number>();
  for (const r of rows) {
    const k = r.fullName.trim().toLowerCase();
    nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
  }

  rows.forEach((r) => {
    if (!r.fullName.trim()) {
      issues.push({ level: 'error', row: r.row, message: `Dòng ${r.row}: thiếu họ tên giáo viên` });
    }
    if (r.code && dupInFile.has(r.code)) {
      issues.push({ level: 'error', row: r.row, field: 'code',
        message: `Dòng ${r.row}: trùng mã ${r.code} trong file` });
    }
    if (r.code && existing.has(r.code)) {
      issues.push({ level: 'error', row: r.row, field: 'code',
        message: `Mã ${r.code} đã tồn tại trong hệ thống` });
    }
    if (r.maxPeriods !== undefined && (r.maxPeriods < 1 || r.maxPeriods > 30)) {
      issues.push({ level: 'warning', row: r.row,
        message: `Dòng ${r.row}: định mức ${r.maxPeriods} tiết/tuần có vẻ bất thường` });
    }
    if (r.email && !isValidEmail(r.email)) {
      issues.push({ level: 'warning', row: r.row, message: `Dòng ${r.row}: email không đúng định dạng` });
    }
    const n = nameCount.get(r.fullName.trim().toLowerCase()) ?? 0;
    if (n > 1) {
      issues.push({ level: 'info', row: r.row,
        message: `Có ${n} giáo viên cùng tên "${r.fullName}" — nên đặt mã GV để phân biệt` });
    }
  });

  return issues;
}

/* ================= Sheet Lớp ================= */

export interface ClassRow {
  row: number;
  name: string;
  grade?: string | number;
  size?: number;
  homeroomTeacherName?: string;
}

export function validateClasses(rows: ClassRow[], teacherNames: Set<string>): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.name.trim(), (seen.get(r.name.trim()) ?? 0) + 1);
  const homeroomCount = new Map<string, number>();

  for (const r of rows) {
    if (!r.name.trim()) {
      issues.push({ level: 'error', row: r.row, message: `Dòng ${r.row}: thiếu tên lớp` });
      continue;
    }
    if ((seen.get(r.name.trim()) ?? 0) > 1) {
      issues.push({ level: 'error', row: r.row, message: `Dòng ${r.row}: tên lớp "${r.name}" bị lặp` });
    }
    const gradeNum = typeof r.grade === 'number' ? r.grade
      : parseInt(String(r.grade ?? '') || (r.name.match(/^(\d+)/)?.[1] ?? ''), 10);
    if (!gradeNum || gradeNum < 1 || gradeNum > 12) {
      issues.push({ level: 'error', row: r.row,
        message: `Dòng ${r.row}: không xác định được khối của lớp "${r.name}"` });
    }
    if (r.homeroomTeacherName) {
      const key = r.homeroomTeacherName.trim().toLowerCase();
      homeroomCount.set(key, (homeroomCount.get(key) ?? 0) + 1);
      if (!teacherNames.has(key)) {
        issues.push({ level: 'error', row: r.row,
          message: `Dòng ${r.row}: Không tìm thấy giáo viên "${r.homeroomTeacherName}"` });
      }
    }
    if (r.size !== undefined && (r.size < 10 || r.size > 60)) {
      issues.push({ level: 'info', row: r.row,
        message: `Dòng ${r.row}: sĩ số ${r.size} nằm ngoài khoảng thường thấy (10–60)` });
    }
  }

  for (const [key, n] of homeroomCount) {
    if (n > 1) {
      issues.push({ level: 'warning', row: 0,
        message: `${key} được đặt chủ nhiệm ${n} lớp — mỗi GV chủ nhiệm tối đa 1 lớp` });
    }
  }

  return issues;
}

/* ================= Sheet Phân công (dạng dọc) ================= */

export interface AssignmentRow {
  row: number;
  className: string;
  subject: string;
  teacherName: string;
  periodsPerWeek?: number;
}

export interface AssignmentContext {
  classNames: Set<string>;
  subjectNames: Set<string>;
  teacherMatcher: TeacherMatcher;
  /** Tổng tiết tối đa một lớp được phân công/tuần (= khung tiết) */
  frameSlotsPerClass?: number;
  /** Định mức GV: tên đã chuẩn hoá -> số tiết tối đa */
  teacherLimits?: Map<string, number>;
  /** Số tiết chuẩn của (môn) để cảnh báo lệch cấu hình */
  standardPeriodsBySubject?: Map<string, number>;
}

export function validateAssignments(
  rows: AssignmentRow[],
  ctx: AssignmentContext,
): Issue[] {
  const issues: Issue[] = [];
  const perClassTotal = new Map<string, number>();
  const perTeacherTotal = new Map<string, number>();
  const pairSeen = new Map<string, number>();

  for (const r of rows) {
    const cls = r.className.trim();
    if (!ctx.classNames.has(cls)) {
      issues.push({ level: 'error', row: r.row,
        message: `Dòng ${r.row}: không có lớp "${cls}"` });
    }
    if (!ctx.subjectNames.has(r.subject.trim())) {
      issues.push({ level: 'error', row: r.row,
        message: `Dòng ${r.row}: không có môn "${r.subject}"` });
    }
    const m = ctx.teacherMatcher.match(r.teacherName);
    if (m.kind === 'none') {
      issues.push({ level: 'error', row: r.row,
        message: `Dòng ${r.row}: không tìm thấy giáo viên "${r.teacherName}"` });
    } else if (m.kind === 'suggest') {
      issues.push({ level: 'warning', row: r.row,
        message: `Dòng ${r.row}: không tìm thấy "${r.teacherName}". Ý bạn là "${m.suggestion.name}"?` });
    } else if (m.kind === 'ambiguous') {
      issues.push({ level: 'error', row: r.row,
        message: `Dòng ${r.row}: có ${m.candidates.length} giáo viên trùng tên — hãy dùng mã GV` });
    }

    const ppw = r.periodsPerWeek ?? 0;
    if (!(ppw > 0)) {
      issues.push({ level: 'error', row: r.row, message: `Dòng ${r.row}: số tiết phải > 0` });
    }

    const pairKey = cls.toLowerCase() + '|' + r.subject.trim().toLowerCase();
    pairSeen.set(pairKey, (pairSeen.get(pairKey) ?? 0) + 1);
    if ((pairSeen.get(pairKey) ?? 0) === 2) {
      issues.push({ level: 'error', row: r.row,
        message: `Lớp ${cls} môn ${r.subject} bị phân công hai lần` });
    }

    perClassTotal.set(cls, (perClassTotal.get(cls) ?? 0) + Math.max(0, ppw));
    const tm = m.kind === 'code' || m.kind === 'exact' || m.kind === 'partial'
      ? m.teacher.name : r.teacherName;
    perTeacherTotal.set(tm.toLowerCase(), (perTeacherTotal.get(tm.toLowerCase()) ?? 0) + Math.max(0, ppw));

    const std = ctx.standardPeriodsBySubject?.get(r.subject.trim().toLowerCase());
    if (std !== undefined && ppw !== std) {
      issues.push({ level: 'warning', row: r.row,
        message: `Dòng ${r.row}: ${r.subject} chuẩn là ${std} tiết, file ghi ${ppw} tiết` });
    }
  }

  const frame = ctx.frameSlotsPerClass;
  if (frame) {
    for (const [cls, total] of perClassTotal) {
      if (total > frame) {
        issues.push({ level: 'error', row: 0,
          message: `Lớp ${cls} được phân công ${total} tiết nhưng khung chỉ có ${frame} ô` });
      }
    }
  }
  for (const [tName, total] of perTeacherTotal) {
    const limit = ctx.teacherLimits?.get(tName);
    if (limit !== undefined && total > limit) {
      issues.push({ level: 'warning', row: 0,
        message: `${tName}: ${total} tiết, vượt định mức ${limit} tiết` });
    }
  }

  return issues;
}
