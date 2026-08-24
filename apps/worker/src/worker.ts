import { Worker, Queue } from 'bullmq';
import type { SolverProblem, SolverOptions } from '@tkb/solver-core';
import { solve } from '@tkb/solver-core';

/**
 * Lớp vận hành quanh thuật toán đã kiểm chứng trong @tkb/solver-core.
 * REDIS_URL thiếu -> chạy hàng đợi trong bộ nhớ cho dev/test (cùng interface).
 */

export const QUEUE_NAME = 'tkb-solve';

export interface SolveJobData {
  jobId: string;
  timetableId: string;
  problem: SolverProblem;
  options?: SolverOptions;
}

export type ProgressSink = (e: unknown) => void;

/** Gọi trực tiếp thuật toán — worker chỉ là vỏ bọc quanh hàm này. */
export function runSolveJob(data: SolveJobData, sink?: ProgressSink) {
  return solve(data.problem, {
    ...data.options,
    onProgress: (e) => {
      sink?.({ type: 'solver.progress', jobId: data.jobId, timetableId: data.timetableId, ...e });
      data.options?.onProgress?.(e);
    }
  });
}

interface MinimalQueue {
  add(name: string, data: SolveJobData): Promise<unknown>;
  close(): Promise<void>;
}
interface MinimalWorker {
  close(): Promise<void>;
}

/** Hàng đợi trong bộ nhớ — dev không Redis và unit test */
export class MemoryQueueAdapter implements MinimalQueue {
  private handlers = new Map<string, (job: { data: SolveJobData }) => Promise<void>>();
  constructor() {}
  registerHandler(name: string, fn: (job: { data: SolveJobData }) => Promise<void>) {
    this.handlers.set(name, fn);
  }
  async add(name: string, data: SolveJobData) {
    const fn = this.handlers.get(name);
    if (fn) await fn({ data });
    return { id: data.jobId };
  }
  async close() {}
}

export function createBullQueue(redisUrl: string): MinimalQueue {
  const q = new Queue<SolveJobData>(QUEUE_NAME, { connection: { url: redisUrl } as any });
  return {
    add: (name, data) => q.add(name, data, { attempts: 1, removeOnComplete: 100 }),
    close: () => q.close()
  };
}

export function createBullWorker(
  redisUrl: string,
  handler: (data: SolveJobData, sink: ProgressSink) => Promise<void>,
): MinimalWorker {
  const w = new Worker<SolveJobData>(
    QUEUE_NAME,
    async (job) => {
      await handler(job.data, (e) => void job.updateProgress(e as any));
    },
    { connection: { url: redisUrl } as any, concurrency: 1 }
  );
  return { close: () => w.close() };
}

/* ---------- CLI entry: node src/worker.ts ---------- */
if (process.argv[1] && process.argv[1].endsWith('worker.ts')) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.error('Thiếu REDIS_URL — worker cần Redis để nhận job.');
    process.exit(1);
  }
  const sink: ProgressSink = (e) => {
    // TODO: phát qua Redis pub/sub -> WebSocket gateway (api spec §5)
    console.log('[progress]', JSON.stringify(e));
  };
  createBullWorker(redisUrl, async (data, cb) => {
    const result = runSolveJob(data, cb);
    // TODO: ghi kết quả vào lessons bằng delete-reinsert một transaction
    // (dùng resultToWrites ở db-map.ts + DbService cùng kiểu với apps/api).
    console.log(`job ${data.jobId}: placed ${result.placed}/${result.totalLessons}, score ${result.softScore}`);
  });
  console.log(`Solver worker đang chờ job trên queue "${QUEUE_NAME}".`);
}
