import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  userId?: string;
  schoolId?: string;
  role?: string;
  connectionId?: string;
}

/**
 * Store độc lập để tầng DB và middleware cùng sử dụng mà không tạo vòng import.
 */
export const requestContext = new AsyncLocalStorage<RequestContextData>();
