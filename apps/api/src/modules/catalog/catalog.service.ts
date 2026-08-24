import { Inject, Injectable } from '@nestjs/common';
import postgres from 'postgres';
import { DbService } from '../../db/db.service.js';
import { ApiError, notFound } from '../../common/api-error.js';
import {
  CATALOG, pickColumns, validatePayload, validateBulkItems,
  validateGradeConfigs, validateTeacherSubjects,
  type ResourceDef
} from './catalog.schema.ts';

/**
 * CRUD danh mục chung cho 6 resource (api spec §2 — Danh mục).
 * RLS lo cách ly trường; :yid lo phạm vi năm học; whitelist cột chặn
 * ghi đè school_id/school_year_id/id từ body (xem catalog.schema.ts).
 */

@Injectable()
export class CatalogService {
  constructor(@Inject(DbService) private db: DbService) {}

  private def(resource: string): ResourceDef {
    const def = CATALOG[resource];
    if (!def) throw new ApiError(404, 'UNKNOWN_RESOURCE', `Danh mục "${resource}" không tồn tại.`);
    return def;
  }

  private assertValid(def: ResourceDef, body: Record<string, unknown>, create: boolean) {
    const issues = validatePayload(def, body, { create });
    if (issues.length) {
      throw new ApiError(422, 'VALIDATION', issues[0].message,
        { issues });
    }
  }

  list(resource: string, yid: string) {
    const def = this.def(resource);
    return this.db.tx(async (sql) => {
      const order = def.table === 'classes' ? 'sort_order NULLS LAST, name'
                  : 'name';
      const rows = await sql.unsafe(
        `SELECT * FROM ${def.table} WHERE school_year_id = $1 ORDER BY ${order}`,
        [yid]
      );
      return { data: rows };
    });
  }

  async getOne(resource: string, yid: string, id: string) {
    const def = this.def(resource);
    const rows = await this.db.tx(async (sql) =>
      sql.unsafe(`SELECT * FROM ${def.table} WHERE id = $1 AND school_year_id = $2`, [id, yid])
    );
    if (!rows.length) throw notFound(`bản ghi ${resource}`);
    return rows[0];
  }

  create(resource: string, yid: string, body: Record<string, unknown>) {
    const def = this.def(resource);
    this.assertValid(def, body, true);
    const data = pickColumns(def, body);

    return this.db.tx(async (sql) => {
      const cols = Object.keys(data);
      const placeholders = cols.map((_c, i) => `$${i + 3}`);
      const rows = await sql.unsafe(
        `INSERT INTO ${def.table} (school_id, school_year_id${cols.length ? ', ' + cols.join(', ') : ''})
         VALUES ($1, $2${placeholders.length ? ', ' + placeholders.join(', ') : ''})
         RETURNING *`,
        // school_id lấy từ ngữ cảnh RLS hiện hành — không tin body
        [await currentSchool(sql), yid, ...Object.values(data) as any[]]
      );
      return rows[0];
    });
  }

  update(resource: string, yid: string, id: string, body: Record<string, unknown>) {
    const def = this.def(resource);
    this.assertValid(def, body, false);
    const data = pickColumns(def, body);
    if (!Object.keys(data).length) {
      throw new ApiError(400, 'EMPTY_PATCH', 'Không có trường nào để cập nhật.');
    }

    return this.db.tx(async (sql) => {
      const sets = Object.keys(data).map((c, i) => `${c} = $${i + 3}`);
      const rows = await sql.unsafe(
        `UPDATE ${def.table} SET ${sets.join(', ')}
         WHERE id = $1 AND school_year_id = $2 RETURNING *`,
        [id, yid, ...Object.values(data) as any[]]
      );
      if (!rows.length) throw notFound(`bản ghi ${resource}`);
      return rows[0];
    });
  }

  remove(resource: string, yid: string, id: string) {
    const def = this.def(resource);
    return this.db.tx(async (sql) => {
      try {
        const rows = await sql.unsafe(
          `DELETE FROM ${def.table} WHERE id = $1 AND school_year_id = $2 RETURNING id`,
          [id, yid]
        );
        if (!rows.length) throw notFound(`bản ghi ${resource}`);
        return { ok: true };
      } catch (e: any) {
        if (e?.code === '23503') {
          throw new ApiError(409, 'IN_USE',
            'Bản ghi đang được dữ liệu khác tham chiếu — không xoá được.');
        }
        throw e;
      }
    });
  }

  /** Bulk trong MỘT transaction — hỏng một là hỏng cả gói (excel_import §5.3) */
  bulk(resource: string, yid: string, items: Array<{ op?: string; id?: string; data?: any }>) {
    const def = this.def(resource);
    const errs = validateBulkItems(def, items ?? []);
    if (errs.length) {
      throw new ApiError(422, 'VALIDATION', 'Một số mục bulk không hợp lệ.',
        { items: errs });
    }
    return this.db.tx(async (sql) => {
      const results: unknown[] = [];
      for (const item of items ?? []) {
        if ((item.op ?? 'create') === 'create') {
          results.push(await this.create(resource, yid, item.data));
        } else {
          results.push(await this.update(resource, yid, item.id!, item.data));
        }
      }
      return { data: results };
    });
  }

  /** PUT subjects/:id/grade-configs — ghi đè toàn bộ cấu hình theo khối */
  setGradeConfigs(yid: string, subjectId: string, payload: unknown) {
    const parsed = validateGradeConfigs(payload);
    if (!parsed.ok) {
      throw new ApiError(422, 'VALIDATION', parsed.issues[0].message, { issues: parsed.issues });
    }
    return this.db.tx(async (sql) => {
      const [subj] = await sql`
        SELECT id FROM subjects WHERE id = ${subjectId} AND school_year_id = ${yid}`;
      if (!subj) throw notFound('môn học');

      const gradeRows = await sql`
        SELECT id, ordinal FROM grades WHERE school_year_id = ${yid}`;
      const gradeIdByOrd = new Map(gradeRows.map((g: any) => [g.ordinal, g.id] as const));

      await sql`DELETE FROM subject_grade_configs WHERE subject_id = ${subjectId}`;
      for (const r of parsed.rows) {
        const gid = gradeIdByOrd.get(r.gradeOrdinal);
        if (!gid) continue; // khối không tồn tại ở trường này — bỏ im lặng
        await sql`
          INSERT INTO subject_grade_configs (school_id, subject_id, grade_id, periods_per_week)
          VALUES (${await currentSchool(sql)}, ${subjectId}, ${gid}, ${r.periodsPerWeek})`;
      }
      return { ok: true, rows: parsed.rows.length };
    });
  }

  /** PUT teachers/:id/subjects — môn dạy được, ghi đè toàn bộ */
  setTeacherSubjects(yid: string, teacherId: string, payload: unknown) {
    const parsed = validateTeacherSubjects(payload);
    if (!parsed.ok) {
      throw new ApiError(422, 'VALIDATION', parsed.issues[0].message, { issues: parsed.issues });
    }
    return this.db.tx(async (sql) => {
      const [t] = await sql`
        SELECT id FROM teachers WHERE id = ${teacherId} AND school_year_id = ${yid}`;
      if (!t) throw notFound('giáo viên');

      await sql`DELETE FROM teacher_subjects WHERE teacher_id = ${teacherId}`;
      for (const sid of parsed.subjectIds) {
        await sql`
          INSERT INTO teacher_subjects (teacher_id, subject_id)
          VALUES (${teacherId}, ${sid}) ON CONFLICT DO NOTHING`;
      }
      return { ok: true, count: parsed.subjectIds.length };
    });
  }

  /** POST years — tạo năm học (is_active=false, người dùng kích hoạt sau) */
  createYear(sid: string, body: { name?: string; activeDays?: number[] }) {
    const name = String(body?.name ?? '').trim();
    if (!/^\d{4}-\d{4}$/.test(name)) {
      throw new ApiError(422, 'VALIDATION', 'Tên năm học phải theo mẫu 2026-2027');
    }
    return this.db.tx(async (sql) => {
      const dup = await sql`
        SELECT id FROM school_years WHERE school_id = ${sid} AND name = ${name}`;
      if (dup.length) throw new ApiError(409, 'ALREADY_EXISTS', `Năm học ${name} đã tồn tại.`);
      const [row] = await sql`
        INSERT INTO school_years (school_id, name, is_active, active_days)
        VALUES (${sid}, ${name}, false,
                ${body?.activeDays?.length ? body.activeDays : [1, 2, 3, 4, 5, 6]})
        RETURNING *`;
      return row;
    });
  }

  /** POST periods/bulk — tạo khung tiết hàng loạt cho năm học */
  async bulkPeriods(sid: string, yid: string, slots: Array<{
    session: string; ordinal: number; name: string;
    startTime?: string | null; endTime?: string | null; dayPosition: number;
  }>) {
    if (!Array.isArray(slots) || !slots.length) {
      throw new ApiError(422, 'VALIDATION', 'Thiếu danh sách tiết.');
    }
    return this.db.tx(async (sql) => {
      for (const s of slots) {
        await sql`
          INSERT INTO periods (school_id, school_year_id, session, ordinal, name,
                               start_time, end_time, day_position)
          VALUES (${sid}, ${yid}, ${s.session}, ${s.ordinal}, ${s.name},
                  ${s.startTime ?? null}, ${s.endTime ?? null}, ${s.dayPosition})
          ON CONFLICT (school_year_id, session, ordinal) DO NOTHING`;
      }
      const rows = await sql`
        SELECT id, session, ordinal, name, start_time::text AS start, end_time::text AS end,
               day_position AS "dayPosition"
        FROM periods WHERE school_year_id = ${yid} ORDER BY day_position`;
      return { data: rows };
    });
  }

  /** GET years — bộ chọn ngữ cảnh; is_active đứng đầu */
  listYears(sid: string) {
    return this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT id, name, is_active AS "isActive", active_days AS "activeDays"
        FROM school_years WHERE school_id = ${sid}
        ORDER BY is_active DESC, name DESC`;
      return { data: rows };
    });
  }

  /** GET periods — khung tiết theo thứ tự vị trí trong ngày */
  listPeriods(yid: string) {
    return this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT id, session, ordinal, name,
               start_time::text AS start, end_time::text AS end,
               day_position AS "dayPosition"
        FROM periods WHERE school_year_id = ${yid}
        ORDER BY day_position`;
      return { data: rows };
    });
  }

  /** GET teachers/workload — view sẵn trong schema */
  workload(yid: string) {
    return this.db.tx(async (sql) => {
      const rows = await sql`
        SELECT w.teacher_id, w.full_name, w.max_periods_per_week AS limit,
               w.assigned_periods
        FROM v_teacher_workload w
        WHERE w.school_year_id = ${yid}
        ORDER BY w.assigned_periods DESC`;
      return { data: rows };
    });
  }
}

/** current_school_id() đã có trong DB qua GUC — đọc lại cho param $1 */
async function currentSchool(sql: postgres.TransactionSql<any>): Promise<string> {
  const [r] = await sql`SELECT current_school_id() AS sid`;
  if (!r?.sid) {
    throw new ApiError(403, 'NO_SCHOOL_CONTEXT', 'Thiếu ngữ cảnh trường (X-School-Id).');
  }
  return r.sid;
}

export type { ResourceDef };
