import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Logger } from 'pino';
import type { TokenService } from '@universal-booking/auth';
import type { RealtimePublisher } from '../context';

export function attachRealtime(ioServer: HttpServer, tokens: TokenService, log: Logger, enabled: boolean): RealtimePublisher {
  if (!enabled) return { publish: () => undefined };

  const io = new Server(ioServer, { path: '/realtime', cors: { origin: true, credentials: true } });

  io.use(async (socket, next) => {
    const auth = socket.handshake.auth as { token?: string; bookingToken?: string; tenantId?: string };
  const raw = auth.token ?? socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!raw) return next(new Error('Unauthorized'));
    try {
      const claims = await tokens.verify(raw, 'access');
      (socket.data as { tenantId?: string; userId?: string }).tenantId = claims.tid ?? auth.tenantId ?? undefined;
      (socket.data as { userId?: string }).userId = claims.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as { tenantId?: string };
    if (!data.tenantId) return socket.disconnect();
    socket.on('subscribe', (channel: string) => {
      if (!['bookings', 'availability', 'dashboard'].includes(channel)) return;
      void socket.join(`tenant:${data.tenantId}:${channel}`);
    });
  });

  return {
    publish(tenantId, channel, event, payload) {
      io.to(`tenant:${tenantId}:${channel}`).emit(event, payload);
      log.debug({ tenantId, channel, event }, 'realtime publish');
    },
  };
}