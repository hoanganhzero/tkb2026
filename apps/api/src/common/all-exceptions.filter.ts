import { Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiError } from './api-error.js';

/**
 * Khuôn dạng lỗi DUY NHẤT của toàn hệ thống — tkb_api_spec.md §1.3:
 *   { error: { code, message, details? }, requestId }
 * `message` là tiếng Việt hiển thị thẳng cho người dùng.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = 500;
    let body: any;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      body = { error: { code: exception.code, message: exception.viMessage, details: exception.details } };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const r = exception.getResponse() as any;
      const msg = typeof r === 'string' ? r : (r?.message ?? 'Yêu cầu không hợp lệ.');
      body = { error: { code: 'HTTP_' + status, message: Array.isArray(msg) ? msg.join('; ') : msg } };
    } else {
      console.error('[unhandled]', exception);
      body = {
        error: {
          code: 'INTERNAL',
          message: 'Lỗi hệ thống. Vui lòng thử lại; nếu lặp lại, liên hệ hỗ trợ kèm mã yêu cầu.'
        }
      };
    }

    res.status(status).json({ ...body, requestId: req.requestId });
  }
}
