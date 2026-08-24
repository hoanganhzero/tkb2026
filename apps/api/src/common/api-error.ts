import { HttpException } from '@nestjs/common';

/** Lỗi nghiệp vụ theo khuôn dạng tkb_api_spec.md §1.3. */
export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: string,
    readonly viMessage: string,
    readonly details?: unknown,
  ) {
    super({ code, viMessage, details }, status);
  }
}

export const notFound = (what: string) =>
  new ApiError(404, 'NOT_FOUND', `Không tìm thấy ${what}, hoặc nó không thuộc trường hiện tại.`);

export const staleVersion = (currentVersion: number) =>
  new ApiError(409, 'STALE_VERSION',
    'Dữ liệu vừa được người khác cập nhật. Hãy tải lại lưới trước khi tiếp tục.',
    { currentVersion });
