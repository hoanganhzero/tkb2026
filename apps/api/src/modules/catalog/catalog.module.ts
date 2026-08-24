import {
  Body, Controller, Delete, Get, Inject, Module, Param, Patch, Post, Put
} from '@nestjs/common';
import { CatalogService } from './catalog.service.js';

/**
 * CRUD danh mục — khuôn từ tkb_api_spec.md §2 (Danh mục).
 * Đường dẫn: /schools/:sid/years/:yid/{resource}[/:id]
 * Resource hợp lệ: grades departments subjects rooms teachers classes.
 */
@Controller('schools/:sid')
export class YearsController {
  constructor(@Inject(CatalogService) private svc: CatalogService) {}

  @Post('years')
  createYear(
    @Param('sid') sid: string,
    @Body() body: { name?: string; activeDays?: number[] },
  ) {
    return this.svc.createYear(sid, body);
  }

  /** Năm học của trường — cho bộ chọn ngữ cảnh trên topbar */
  @Get('years')
  years(@Param('sid') sid: string) {
    return this.svc.listYears(sid);
  }
}

@Controller('schools/:sid/years/:yid')
export class CatalogController {
  constructor(@Inject(CatalogService) private svc: CatalogService) {}

  /* ---- Endpoint đặc biệt đặt TRƯỚC route generic :resource/:id ---- */

  @Post('periods/bulk')
  bulkPeriods(
    @Param('sid') sid: string,
    @Param('yid') yid: string,
    @Body() body: { slots?: Array<{ session: string; ordinal: number; name: string; startTime?: string; endTime?: string; dayPosition: number }> },
  ) {
    return this.svc.bulkPeriods(sid, yid, body?.slots ?? []);
  }

  /** Khung tiết của năm đang chọn */
  @Get('periods')
  periods(@Param('yid') yid: string) {
    return this.svc.listPeriods(yid);
  }

  @Get('teachers/workload')
  workload(@Param('yid') yid: string) {
    return this.svc.workload(yid);
  }

  @Put('subjects/:id/grade-configs')
  setGradeConfigs(@Param('yid') yid: string, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.setGradeConfigs(yid, id, body);
  }

  @Put('teachers/:id/subjects')
  setTeacherSubjects(@Param('yid') yid: string, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.setTeacherSubjects(yid, id, body);
  }

  /* ---- Generic CRUD ---- */

  @Get(':resource')
  list(@Param('resource') resource: string, @Param('yid') yid: string) {
    return this.svc.list(resource, yid);
  }

  @Get(':resource/:id')
  getOne(
    @Param('resource') resource: string,
    @Param('yid') yid: string,
    @Param('id') id: string,
  ) {
    return this.svc.getOne(resource, yid, id);
  }

  @Post(':resource')
  create(
    @Param('resource') resource: string,
    @Param('yid') yid: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.svc.create(resource, yid, body);
  }

  @Post(':resource/bulk')
  bulk(
    @Param('resource') resource: string,
    @Param('yid') yid: string,
    @Body() body: { items?: Array<{ op?: string; id?: string; data?: any }> },
  ) {
    return this.svc.bulk(resource, yid, body?.items ?? []);
  }

  @Patch(':resource/:id')
  update(
    @Param('resource') resource: string,
    @Param('yid') yid: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.svc.update(resource, yid, id, body);
  }

  @Delete(':resource/:id')
  remove(
    @Param('resource') resource: string,
    @Param('yid') yid: string,
    @Param('id') id: string,
  ) {
    return this.svc.remove(resource, yid, id);
  }
}

@Module({
  controllers: [YearsController, CatalogController],
  providers: [CatalogService]
})
export class CatalogModule {}
