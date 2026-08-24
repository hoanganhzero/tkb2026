/**
 * Mapper thuần client-row -> giá trị DB (import-core) — KHÔNG import Nest
 * để node strip-types chạy test trực tiếp được (session-log mục 9.5).
 */
import {
  stripTitle, parseGender, normalizePhone, parseIntCell,
  type TeacherRow
} from '@tkb/import-core';

export interface ClientTeacherRow { row: number; values: Record<string, unknown> }

export function toDbValues(row: ClientTeacherRow): TeacherRow {
  const v = row.values ?? {};
  const name = stripTitle(String(v.full_name ?? ''), parseGender(String(v.gender ?? '')));
  const phone = normalizePhone(String(v.phone ?? '')) ?? undefined;
  const maxP = v.max_periods !== undefined && v.max_periods !== ''
    ? parseIntCell(v.max_periods) : undefined;
  return {
    row: row.row,
    fullName: name.name,
    gender: name.gender ?? parseGender(String(v.gender ?? '')),
    code: v.code ? String(v.code).trim() : undefined,
    department: v.department ? String(v.department).trim() : undefined,
    subjectsText: v.subjects ? String(v.subjects) : undefined,
    maxPeriods: maxP,
    email: v.email ? String(v.email).trim() : undefined,
    phone,
  };
}

export interface ExistingTeacher { code: string; name: string }
