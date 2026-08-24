import {
  OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, WebSocketGateway, WebSocketServer
} from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { Inject } from '@nestjs/common';
import { ChannelRegistry, envelope } from './events.js';
import { verifyJwt } from '../common/jwt.util.js';
import { DbService } from '../db/db.service.js';

/**
 * Gateway sự kiện thời gian thực — tkb_api_spec.md §5.
 * Kết nối: /v1/ws?token=<access_token>&connectionId=conn_x
 * Client gửi {type:'subscribe', channels:[...], since?} — server phát lại từ
 * buffer; hụt quá xa trả resync_required. Broadcast lọc originConnectionId.
 */

interface ConnState {
  userId: string;
  connectionId: string;
  channels: Set<string>;
}

@WebSocketGateway({ path: '/v1/ws', cors: { origin: true } })
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  private registry = new ChannelRegistry();
  private conns = new Map<string, ConnState>();

  constructor(@Inject(DbService) private db: DbService) {}

  handleConnection(client: Socket): void {
    try {
      const token = String(client.handshake.query?.token ?? '');
      const userId = String(verifyJwt(token).sub);
      const connectionId = String(client.handshake.query?.connectionId ?? client.id);
      client.data.state = { userId, connectionId, channels: new Set() } as ConnState;
      this.conns.set(connectionId, client.data.state);
    } catch {
      client.emit('event', { type: 'error', data: { message: 'Token không hợp lệ' } });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const st = client.data?.state as ConnState | undefined;
    if (st) this.conns.delete(st.connectionId);
  }

  /** Kiểm tra thành viên trường trước khi cho subscribe kênh (RLS-parity) */
  private async canReadChannel(userId: string, channel: string): Promise<boolean> {
    const m = channel.match(/^timetable:([0-9a-f-]{36})$/i);
    if (m) {
      const rows = await this.db.sql`
        SELECT 1 FROM school_members m
        JOIN timetables t ON t.school_id = m.school_id
        WHERE t.id = ${m[1]} AND m.user_id = ${userId} AND m.status = 'active'`;
      return rows.length > 0;
    }
    const s = channel.match(/^school:([0-9a-f-]{36})$/i);
    if (s) {
      const rows = await this.db.sql`
        SELECT 1 FROM school_members
        WHERE school_id = ${s[1]} AND user_id = ${userId} AND status = 'active'`;
      return rows.length > 0;
    }
    return false; // kênh lạ mặc định từ chối
  }

  @SubscribeMessage('subscribe')
  async onSubscribe(client: Socket, msg: { channels?: string[]; since?: Record<string, number> }) {
    const st = client.data.state as ConnState | undefined;
    if (!st) return;

    for (const ch of msg.channels ?? []) {
      if (!(await this.canReadChannel(st.userId, ch))) continue;
      st.channels.add(ch);
      void this.server.in(ch).socketsJoin(ch);

      const since = msg.since?.[ch];
      if (since !== undefined) {
        const replay = this.registry.channel(ch).since(Number(since));
        if (replay === null) {
          client.emit('event', { type: 'resync_required', channel: ch, data: {} });
        } else {
          for (const data of replay) client.emit('event', { type: '__replay__', channel: ch, data });
        }
      }
    }
    client.emit('event', { type: 'subscribed', data: { channels: [...st.channels] } });
  }

  /**
   * API/worker gọi để phát sự kiện (qua inject trực tiếp hoặc Redis pub/sub sau này).
   * Không emit về chính connectionId nguồn (§5.4).
   */
  broadcast(
    channel: string,
    type: string,
    data: unknown,
    opts: { actorUserId?: string; actorName?: string; originConnectionId?: string } = {},
  ): void {
    const e = envelope(this.registry, channel, type, data, {
      ...(opts.actorUserId ? { actor: { userId: opts.actorUserId, name: opts.actorName } } : {}),
      originConnectionId: opts.originConnectionId,
    });
    // Emit thủ công từng socket để lọc origin — rooms của io.to() không lọc được
    for (const [, st] of this.conns) {
      if (!st.channels.has(channel)) continue;
      if (opts.originConnectionId && st.connectionId === opts.originConnectionId) continue;
      const sock = [...(this.server.sockets as any).sockets.values()]
        .find((s: any) => s.data?.state?.connectionId === st.connectionId);
      sock?.emit('event', e);
    }
  }
}
