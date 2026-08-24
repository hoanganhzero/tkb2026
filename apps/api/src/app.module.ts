import { MiddlewareConsumer, Module, NestModule, Controller, Get } from '@nestjs/common';
import { DbModule } from './db/db.service.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TimetablesModule } from './modules/timetables/timetables.module.js';
import { LocksModule } from './modules/locks/locks.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { AssignmentsModule } from './modules/assignments/assignments.module.js';
import { AvailabilityModule } from './modules/availability/availability.module.js';
import { SnapshotsModule } from './modules/snapshots/snapshots.module.js';
import { PublishModule } from './modules/publish/publish.module.js';
import { ImportsModule } from './modules/imports/imports.module.js';
import { RolloverModule } from './modules/rollover/rollover.module.js';
import { LessonsPlaceModule } from './modules/timetables/lessons-place.module.js';
import { EventsGateway } from './ws/ws.gateway.js';
import { RequestContextMiddleware } from './common/request-context.middleware.js';

@Controller('healthz')
class HealthController {
  @Get()
  ok() { return { ok: true, service: 'tkb-api', time: new Date().toISOString() }; }
}

@Module({
  imports: [DbModule, AuthModule, TimetablesModule, LocksModule, AssignmentsModule,
            CatalogModule, AvailabilityModule, SnapshotsModule, PublishModule,
            ImportsModule, RolloverModule, LessonsPlaceModule],
  providers: [EventsGateway],
  controllers: [HealthController]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Đặt ngữ cảnh trường + xác thực cho MỌI route; middleware tự bỏ qua
    // /v1/auth và /v1/healthz bên trong.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
