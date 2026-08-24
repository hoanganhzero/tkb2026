import { Body, Controller, Get, Module, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DbService } from '../../db/db.service.js';
import { AssignmentsService } from './assignments.service.js';

/**
 * Phân công giảng dạy — tkb_api_spec.md §2 + màn hình ma trận §7 design spec.
 */
@Controller('schools/:sid/years/:yid/assignments')
export class AssignmentsController {
  constructor(private svc: AssignmentsService) {}

  /** ★ Ma trận Lớp × Môn */
  @Get('matrix')
  matrix(@Param('yid') yid: string) {
    return this.svc.matrix(yid);
  }

  /** Áp trạng thái từng ô (create/update/delete tối thiểu) trong một transaction */
  @Post('bulk')
  bulk(
    @Param('yid') yid: string,
    @Body() body: { items: Array<{ classId: string; subjectId: string; periodsPerWeek?: number; teacherIds?: string[] }> },
  ) {
    return this.svc.applyBulk(yid, body?.items ?? []);
  }

  /** Danh sách cảnh báo thiếu/thừa/vượt định mức trên dữ liệu đã lưu */
  @Get('validation')
  validation(@Param('yid') yid: string) {
    return this.svc.validation(yid);
  }

  /** GET export.xlsx?kind=assignments|workload — báo cáo bảng ExcelJS */
  @Get('export.xlsx')
  async exportXlsx(
    @Param('sid') sid: string,
    @Param('yid') yid: string,
    @Query('kind') kind: string,
    @Res() res: Response,
  ) {
    const k = (kind === 'workload') ? 'workload' as const : 'assignments' as const;
    const buffer = await this.svc.exportXlsx(yid, k, sid);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${k === 'workload' ? 'Workload' : 'PhanCong'}_${yid.slice(0, 8)}.xlsx"`,
    });
    return res.send(buffer);
  }
}

@Module({
  controllers: [AssignmentsController],
  providers: [AssignmentsService]
})
export class AssignmentsModule {}
