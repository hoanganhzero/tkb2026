import { Body, Controller, Get, Inject, Module, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TimetablesService } from './timetables.service.js';
import { DbModule } from '../../db/db.service.js';
@Controller('schools/:sid/timetables')
export class TimetablesController {
  constructor(@Inject(TimetablesService) private svc: TimetablesService) {}

  /** ★ GET /schools/:sid/timetables/:tid/grid — tkb_api_spec.md §3 */
  @Get(':tid/grid')
  async grid(
    @Param('tid') tid: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.svc.grid(tid, req.headers['if-none-match'] as string | undefined);
    if (result.notModified) {
      res.set('ETag', result.etag);
      return res.status(304).end();
    }
    res.set('ETag', result.etag);
    res.set('Cache-Control', 'no-cache');
    return res.json(result.payload);
  }
  /** ★ POST /timetables — tạo bản nháp */
  @Post()
  create(
    @Body() body: { name?: string; semesterId?: string | null },
    @Req() _req: Request,
  ) {
    return this.svc.create(body?.name ?? 'TKB mới', body?.semesterId ?? null);
  }

  /** ★ GET .../conflicts — quét + cache xung đột */
  @Get(':tid/conflicts')
  conflicts(@Param('tid') tid: string) {
    return this.svc.conflicts(tid);
  }

  /** ★ GET .../export.xlsx — ExcelJS, export design §3.2 */
  @Get(':tid/export.xlsx')
  async exportXlsx(
    @Param('tid') tid: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.svc.exportXlsx(tid);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    return res.send(buffer);
  }
}

/** Endpoint tuyệt đối theo quy ước tkb_api_spec.md §1.1 */
@Controller('lessons')
export class LessonsController {
  constructor(@Inject(TimetablesService) private svc: TimetablesService) {}

  /** ★ PATCH /lessons/:lid/move — tkb_api_spec.md §4 */
  @Patch(':lid/move')
  move(
    @Param('lid') lid: string,
    @Body() body: { toSlot: { dayOfWeek: number; periodId: string }; expectedVersion?: number; dryRun?: boolean },
  ) {
    return this.svc.move(lid, body);
  }

  /** ★ POST /lessons/:lid/swap — delete-reinsert theo §4.6 */
  @Post(':lid/swap')
  swap(
    @Param('lid') lid: string,
    @Body() body: { withLessonId: string },
  ) {
    return this.svc.swap(lid, body.withLessonId);
  }
}

@Module({
  imports: [DbModule],
  controllers: [TimetablesController, LessonsController],
  providers: [TimetablesService],
  exports: [TimetablesService]
})
export class TimetablesModule {}
