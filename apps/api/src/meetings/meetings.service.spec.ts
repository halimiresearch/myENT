import { MeetingsService } from './meetings.service';

function makeSvc() {
  const tx: any = {
    $queryRawUnsafe: jest.fn().mockResolvedValue([{ ok: true }]),
    meeting: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma: any = {
    meeting: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const config: any = { get: jest.fn().mockResolvedValue({}) };
  const notif: any = { broadcast: jest.fn().mockResolvedValue(undefined) };
  const svc = new MeetingsService(prisma, { log: jest.fn() } as any, config, notif);
  return { svc, prisma, tx };
}

describe('meetings.service - B-02', () => {
  it('qrFor: token QR hidup 5 menit, bukan 50 menit', async () => {
    process.env.JWT_SECRET = 'x'.repeat(32);
    const { svc } = makeSvc();
    const before = Date.now();
    const r = await svc.qrFor('m1');
    const ttl = +new Date(r.expiresAt) - before;
    expect(ttl).toBeGreaterThan(295_000);
    expect(ttl).toBeLessThanOrEqual(305_000);
  });

  it('tick: window reminder penutupan 30 menit, bukan 5 jam', async () => {
    const { svc, tx } = makeSvc();
    const now = new Date('2026-11-01T12:00:00Z');
    await svc.tick(now);
    const calls = tx.meeting.findMany.mock.calls;
    const last = calls[calls.length - 1][0].where; // findMany terakhir = closing
    expect(+last.attendanceCloseAt.lte - +now).toBe(30 * 60_000);
  });
});
