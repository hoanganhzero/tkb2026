import { Body, Controller, Injectable, Module, Post } from '@nestjs/common';
import { TimetablesService } from './timetables.service.js';

/** POST /lessons/place — đặt tiết mới từ phân công (khác move: tạo lesson mới) */
@Controller('lessons')
export class LessonsPlaceController {
  constructor(private svc: TimetablesService) {}

  @Post('place')
  place(@Body() body: { timetableId: string; assignmentId: string; dayOfWeek: number; periodId: string }) {
    return this.svc.placeLesson(body.timetableId, {
      assignmentId: body.assignmentId,
      dayOfWeek: Number(body.dayOfWeek),
      periodId: body.periodId,
    });
  }
}

@Module({
  controllers: [LessonsPlaceController],
  providers: []
})
export class LessonsPlaceModule {}
