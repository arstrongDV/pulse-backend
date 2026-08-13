import { ExecutionContext } from '@nestjs/common';
import { Socket } from 'socket.io';
import { WsThrottlerGuard } from './ws-throttler.guard';
describe('WsThrottlerGuard', () => {
  let guard: WsThrottlerGuard;

  beforeEach(() => {
    guard = new WsThrottlerGuard(
      [{ name: 'default', ttl: 10_000, limit: 10 }],
      {} as never,
      {} as never,
    );
  });

  describe('getTracker', () => {
    it('resolves the userId from the request object', async () => {
      const tracker = await (
        guard as unknown as {
          getTracker: (req: Record<string, unknown>) => Promise<string>;
        }
      ).getTracker({ userId: 'user-1' });

      expect(tracker).toBe('user-1');
    });
  });

  describe('getRequestResponse', () => {
    it('extracts userId from the socket client, and provides a no-op res', () => {
      const client = { data: { userId: 'user-42' } } as unknown as Socket;
      const context = {
        switchToWs: () => ({ getClient: () => client }),
      } as unknown as ExecutionContext;

      const { req, res } = (
        guard as unknown as {
          getRequestResponse: (ctx: ExecutionContext) => {
            req: Record<string, unknown>;
            res: { header: (...args: unknown[]) => void };
          };
        }
      ).getRequestResponse(context);

      expect(req).toEqual({ userId: 'user-42' });
      // Guards against the exact bug that would happen without the
      // no-op res: the base class calls res.header(...) internally —
      // if that's missing/undefined, this throws a TypeError.
      expect(() => res.header('X-RateLimit-Limit', 10)).not.toThrow();
    });
  });
});
