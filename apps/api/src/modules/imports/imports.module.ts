import { Body, Controller, Injectable, Module, Param, Post } from '@nestjs/common';
import { DbService } from '../../db/db.service.js';
import { ImportsService, type ClientTeacherRow } from './imports.service.js';

@Injectable()
export class ImportsGatewayService {
  constructor(private db: DbService, private imp: ImportsService) {}

  async validateTeachers(yid: string, rows: ClientTeacherRow[]) {
    return this.imp.validateTeachers({
      loadExisting: async () => {
        const rows = await this.db.tx(async (sql) => sql`
          SELECT code, full_name AS name FROM teachers
          WHERE school_year_id = ${yid}`);
        return rows as unknown as Array<{ code: string; name: string }>;
      }
    }, rows);
  }

  async commitTeachers(yid: string, mode: 'create' | 'upsert', rows: ClientTeacherRow[]) {
    const issues = (await this.validateTeachers(yid, rows)).data;
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) {
      // Không bao giờ ghi khi còn dòng lỗi (excel_import §1 nguyên tắc 3)
      return { committed: false as const, errors };
    }
    return this.db.tx(async (sql) => {
      const [r] = await sql`SELECT current_school_id() AS sid`;
      if (!r?.sid) throw new Error('Thiếu ngữ cảnh trường');
      const counts = await this.imp.commitTeachers(sql, yid, rows, mode, r.sid);
      return { committed: true as const, ...counts };
    });
  }
}

@Controller('schools/:sid/years/:yid/imports/teachers')
export class ImportsController {
  constructor(private gw: ImportsGatewayService) {}

  @Post('validate')
  validate(@Param('yid') yid: string, @Body() body: { rows?: ClientTeacherRow[] }) {
    return this.gw.validateTeachers(yid, body?.rows ?? []);
  }

  @Post('commit')
  commit(
    @Param('yid') yid: string,
    @Body() body: { rows?: ClientTeacherRow[]; mode?: 'create' | 'upsert' },
  ) {
    return this.gw.commitTeachers(yid, body?.mode ?? 'upsert', body?.rows ?? []);
  }
}

@Module({
  controllers: [ImportsController],
  providers: [ImportsGatewayService, ImportsService]
})
export class ImportsModule {}
