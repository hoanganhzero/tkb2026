import { Injectable } from '@nestjs/common';
import {
  validateTeachers, buildTeacherMatcher,
  type TeacherMatcher, type Issue
} from '@tkb/import-core';
import { toDbValues } from './imports.mapper.js';

/**
 * Nhập giáo viên từ Excel — kiến trúc §5.1: TRÌNH DUYỆT parse file + chạy luật
 * để có phản hồi tức thì; server LUÔN kiểm tra lại bằng cùng package
 * import-core trước khi ghi (không tin dữ liệu client).
 */

export interface ClientTeacherRow { row: number; values: Record<string, unknown> }

export interface ExistingTeacher { code: string; name: string }

@Injectable()
export class ImportsService {
  /** validate: chạy import-core với ngữ cảnh CSDL thật (mã đã tồn tại, matcher tên) */
  async validateTeachers(
    db: { loadExisting(): Promise<ExistingTeacher[]> },
    rowsIn: ClientTeacherRow[],
  ): Promise<{ data: Issue[] }> {
    const existing = await db.loadExisting();
    const matcher: TeacherMatcher = buildTeacherMatcher(existing);
    const rows = rowsIn.map(toDbValues);
    const issues = validateTeachers(rows);
    // Gợi ý tên sai chính tả cho từng dòng (nếu matcher bắt được)
    for (const r of rows) {
      if (!r.fullName) continue;
      const m = matcher.match(r.fullName);
      if (m.kind === 'suggest') {
        issues.push({ level: 'warning', row: r.row,
          message: `Dòng ${r.row}: không tìm thấy "${r.fullName}". Ý bạn là "${m.suggestion.name}"?` });
      }
    }
    return { data: issues };
  }

  /**
   * commit: upsert theo mã GV trong MỘT transaction.
   * Trả số tạo mới / cập nhật. Không bao giờ ghi khi còn lỗi — tầng controller
   * phải gọi validate trước và chỉ commit khi không còn issue mức error.
   */
  async commitTeachers(
    sql: any,
    yid: string,
    rowsIn: ClientTeacherRow[],
    mode: 'create' | 'upsert',
    schoolId: string,
  ): Promise<{ created: number; updated: number }> {
    let created = 0, updated = 0;
    for (const raw of rowsIn) {
      const t = toDbValues(raw);
      const [existing] = await sql`
        SELECT id FROM teachers WHERE school_year_id = ${yid} AND code = ${t.code}`;
      if (existing) {
        if (mode === 'create') continue; // create thuần: bỏ qua trùng mã
        await sql`
          UPDATE teachers SET full_name = ${t.fullName},
             short_name = ${t.fullName.split(' ').pop() ?? null},
             gender = ${t.gender ?? null}, email = ${t.email ?? null},
             phone = ${t.phone ?? null}
           WHERE id = ${existing.id}`;
        updated++;
      } else {
        await sql`
          INSERT INTO teachers (school_id, school_year_id, code, full_name, short_name,
                                gender, email, phone, max_periods_per_week)
          VALUES (${schoolId}, ${yid}, ${t.code}, ${t.fullName},
                  ${t.fullName.split(' ').pop() ?? null}, ${t.gender ?? null},
                  ${t.email ?? null}, ${t.phone ?? null}, ${t.maxPeriods ?? 19})`;
        created++;
      }
    }
    return { created, updated };
  }
}
