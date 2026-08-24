import { Body, Controller, Delete, Get, Injectable, Module, Param, Post, Put, Query } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { ApiError } from '../../common/api-error.js';
import {
  validateSlots, diffSlots,
  type SlotIO, type ExistingSlot
} from './availability.logic.ts';

/**
 * Lưới bận/rảnh cho teacher/class/room — design spec §8.
 * Đường dẫn gọn hơn spec gốc (availability?ownerType=…&ownerId=…) để tránh
 * đụng route ':resource' của catalog. PUT = ghi đè toàn bộ lưới của chủ thể.
 */
@Injectable()
export class AvailabilityService {
  constructor(private db: DbService) {}

  private assertOwnerType(t: string): 'teacher' | 'class' | 'room' {
    if (t === 'teacher' || t === 'class' || t === 'room') return t;
    throw new ApiError(400, 'BAD_OWNER_TYPE', 'ownerType phải là teacher | class | room');
  }

  async list(yid: string, ownerType: string, ownerId: string) {
    const t = this.assertOwnerType(ownerType);
    return this.db.tx(async (sql) => {
      // Kiểm tra chủ thể tồn tại trong năm học
      const table = t === 'teacher' ? 'teachers' : t === 'class' ? 'classes' : 'rooms';
      const rows = await sql.unsafe(
        `SELECT id FROM ${table} WHERE id = $1 AND school_year_id = $2`, [ownerId, yid]);
      if (!rows.length) throw new ApiError(404, 'NOT_FOUND', `Không tìm thấy ${t} này.`);

      const slots = await sql`
        SELECT day_of_week AS "dayOfWeek", period_id AS "periodId",
               preference, reason, is_recurring AS "isRecurring"
        FROM availability_slots
        WHERE school_year_id = ${yid} AND owner_type = ${t} AND owner_id = ${ownerId}
        ORDER BY day_of_week, period_id`;
      return { data: slots };
    });
  }

  /** PUT — ghi đè toàn bộ; diffSlots giúp chỉ chạy số op cần thiết */
  async replaceAll(
    yid: string, ownerType: string, ownerId: string,
    body: { slots?: SlotIO[] },
  ) {
    const t = this.assertOwnerType(ownerType);
    const { issues, clean } = validateSlots(await validPeriods(this.db, yid), body?.slots ?? []);
    if (issues.length) {
      throw new ApiError(422, 'VALIDATION', issues[0].message, { issues });
    }

    return this.db.tx(async (sql) => {
      const existingRows = (await sql`
        SELECT day_of_week, period_id, preference, is_recurring
        FROM availability_slots
        WHERE school_year_id = ${yid} AND owner_type = ${t} AND owner_id = ${ownerId}`) as unknown as ExistingSlot[];
      const d = diffSlots(existingRows, clean);

      for (const k of d.deleteKeys) {
        const [dow, pid] = k.split('|');
        await sql`
          DELETE FROM availability_slots
          WHERE school_year_id = ${yid} AND owner_type = ${t} AND owner_id = ${ownerId}
            AND day_of_week = ${Number(dow)} AND period_id = ${pid}`;
      }
      for (const s of [...d.insert, ...d.update]) {
        await sql`
          INSERT INTO availability_slots
            (school_id, school_year_id, owner_type, owner_id, day_of_week, period_id,
             preference, reason, is_recurring)
          VALUES (current_school_id(), ${yid}, ${t}, ${ownerId},
                  ${s.dayOfWeek}, ${s.periodId}, ${s.preference}, ${s.reason ?? null},
                  ${s.isRecurring ?? false})
          ON CONFLICT (owner_type, owner_id, day_of_week, period_id)
          DO UPDATE SET preference = EXCLUDED.preference,
                        reason = EXCLUDED.reason,
                        is_recurring = EXCLUDED.is_recurring`;
      }
      return { ok: true, inserted: d.insert.length, updated: d.update.length, deleted: d.deleteKeys.length };
    });
  }

  /** POST bulk — quét chuột nhiều ô cùng lúc, upsert từng ô */
  async bulkUpsert(yid: string, body: {
    ownerType: string; ownerId: string;
    cells?: Array<SlotIO & { remove?: boolean }>;
  }) {
    const t = this.assertOwnerType(body?.ownerType ?? '');
    const { issues, clean } = validateSlots(await validPeriods(this.db, yid), body?.cells ?? []);
    if (issues.length) {
      throw new ApiError(422, 'VALIDATION', issues[0].message, { issues });
    }
    void clean;

    return this.db.tx(async (sql) => {
      let upserted = 0, removed = 0;
      for (const c of body.cells ?? []) {
        if (c.remove) {
          await sql`
            DELETE FROM availability_slots
            WHERE school_year_id = ${yid} AND owner_type = ${t} AND owner_id = ${body.ownerId}
              AND day_of_week = ${c.dayOfWeek} AND period_id = ${c.periodId}`;
          removed++;
          continue;
        }
        await sql`
          INSERT INTO availability_slots
            (school_id, school_year_id, owner_type, owner_id, day_of_week, period_id,
             preference, reason, is_recurring)
          VALUES (current_school_id(), ${yid}, ${t}, ${body.ownerId},
                  ${c.dayOfWeek}, ${c.periodId}, ${c.preference}, ${c.reason ?? null},
                  ${c.isRecurring ?? false})
          ON CONFLICT (owner_type, owner_id, day_of_week, period_id)
          DO UPDATE SET preference = EXCLUDED.preference, reason = EXCLUDED.reason,
                        is_recurring = EXCLUDED.is_recurring`;
        upserted++;
      }
      return { ok: true, upserted, removed };
    });
  }
}

async function validPeriods(db: DbService, yid: string): Promise<Set<string>> {
  const rows = await db.tx(async (sql) =>
    sql`SELECT id FROM periods WHERE school_year_id = ${yid}`);
  return new Set(rows.map((r: any) => r.id));
}

@Controller('schools/:sid/years/:yid/availability')
export class AvailabilityController {
  constructor(private svc: AvailabilityService) {}

  @Get()
  list(
    @Param('yid') yid: string,
    @Query('ownerType') ownerType: string,
    @Query('ownerId') ownerId: string,
  ) {
    if (!ownerType || !ownerId) {
      throw new ApiError(400, 'MISSING_PARAM', 'Thiếu ownerType hoặc ownerId.');
    }
    return this.svc.list(yid, ownerType, ownerId);
  }

  @Put()
  replaceAll(
    @Param('yid') yid: string,
    @Query('ownerType') ownerType: string,
    @Query('ownerId') ownerId: string,
    @Body() body: { slots?: SlotIO[] },
  ) {
    return this.svc.replaceAll(yid, ownerType, ownerId, body);
  }

  @Post('bulk')
  bulkUpsert(@Param('yid') yid: string, @Body() body: any) {
    return this.svc.bulkUpsert(yid, body);
  }
}

@Module({
  controllers: [AvailabilityController],
  providers: [AvailabilityService]
})
export class AvailabilityModule {}
