import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import postgres from 'postgres';
import { requestContext } from '../common/request-context.js';

/**
 * Driver postgres.js với `prepare: false` — BẮT BUỘC khi đứng sau PgBouncer
 * mode transaction (tkb_infrastructure.md mục 4.1). Không có cờ này hệ thống
 * chạy bình thường lúc dev và gãy statement khi có tải production.
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  readonly sql: postgres.Sql;

  constructor() {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('Thiếu DATABASE_URL');
    this.sql = postgres(url, { prepare: false, max: 10 });
  }

  /** Mỗi transaction set đúng 3 GUC mà RLS ở tkb_schema.sql mục 12 yêu cầu. */
  async tx<T>(fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T> {
    const ctx = requestContext.getStore();
    return (await this.sql.begin(async (sql) => {
      if (ctx?.schoolId) {
        await sql`SELECT
          set_config('app.current_school_id', ${ctx.schoolId}, true),
          set_config('app.current_user_id',   ${ctx.userId ?? ''}, true),
          set_config('app.current_role',      ${ctx.role === 'teacher' ? 'teacher' : 'staff'}, true)`;
      }
      return fn(sql);
    })) as T;
  }

  async onModuleDestroy() {
    await this.sql.end({ timeout: 1 });
  }
}

@Global()
@Module({
  providers: [DbService],
  exports: [DbService]
})
export class DbModule {}
