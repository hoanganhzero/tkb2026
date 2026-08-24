/**
 * Lõi transport WebSocket — PHẦN THUẦN (test không cần socket).
 * Thiết kế từ tkb_api_spec.md §5:
 *  - seq tăng đơn điệu TRÊN MỖI KÊNH
 *  - resume `since:` phát lại từ buffer (giữ ~500 sự kiện gần nhất)
 *  - khoảng cách quá lớn -> resync_required (client gọi lại GET /grid)
 *  - originConnectionId để KHÔNG echo cho chính người gửi (§5.4)
 */

export interface Envelope<T = unknown> {
  type: string;
  channel: string;
  seq: number;
  ts: string;
  actor?: { userId?: string; name?: string };
  data: T;
  /** Chỉ client có connectionId khác mới nhận — gateway lọc trước khi emit */
  originConnectionId?: string;
}

export class SeqBuffer {
  readonly capacity: number;
  private buf: Array<{ seq: number; type: string; data: unknown }> = [];

  constructor(capacity = 500) {
    this.capacity = capacity;
  }

  append(seq: number, type: string, data: unknown): void {
    this.buf.push({ seq, type, data });
    if (this.buf.length > this.capacity) {
      this.buf.splice(0, this.buf.length - this.capacity);
    }
  }

  latest(): number {
    return this.buf.length ? this.buf[this.buf.length - 1].seq : 0;
  }

  /**
   * Trả danh sách sự kiện sau `since`, hoặc NULL khi khoảng cách vượt buffer
   * (client phải resync bằng GET /grid thay vì tin phần thiếu).
   * Quy tắc: thiếu ngay sự kiện đầu tiên client cần -> resync.
   */
  since(seq: number): Envelope['data'][] | null {
    if (!this.buf.length) return [];
    if (seq + 1 < this.buf[0].seq) return null;
    return this.buf.filter((x) => x.seq > seq).map((x) => x.data);
  }
}

/** Sổ cái kênh của một gateway instance */
export class ChannelRegistry {
  private channels = new Map<string, SeqBuffer>();
  private nextSeq = new Map<string, number>();

  channel(name: string): SeqBuffer {
    let b = this.channels.get(name);
    if (!b) { b = new SeqBuffer(); this.channels.set(name, b); }
    return b;
  }

  /** Tăng seq riêng từng kênh và ghi vào buffer — trả seq vừa cấp */
  publish(name: string, type: string, data: unknown): number {
    const s = (this.nextSeq.get(name) ?? 0) + 1;
    this.nextSeq.set(name, s);
    this.channel(name).append(s, type, data);
    return s;
  }
}

export function envelope<T>(
  registry: ChannelRegistry,
  channel: string,
  type: string,
  data: T,
  opts: { actor?: Envelope['actor']; originConnectionId?: string } = {},
): Envelope<T> {
  const seq = registry.publish(channel, type, data);
  return {
    type, channel, seq,
    ts: new Date().toISOString(),
    ...(opts.actor ? { actor: opts.actor } : {}),
    ...(opts.originConnectionId ? { originConnectionId: opts.originConnectionId } : {}),
    data
  };
}
