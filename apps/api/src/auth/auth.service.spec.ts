import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

describe('auth.service - TTL challenge 2FA (B-02)', () => {
  it('challenge 2FA hidup 5 menit, bukan 50 menit', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1', status: 'ACTIVE', passwordHash: bcrypt.hashSync('Passw0rd!', 4),
          failedLogins: 0, lockedUntil: null, totpEnabled: true, totpSecret: 'sekret',
        }),
      },
      twoFaChallenge: { create: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    const svc = new AuthService(prisma, {} as any, {} as any, { log: jest.fn() } as any);
    const before = Date.now();
    const r = await svc.login('20260001', 'Passw0rd!');
    expect(r).toEqual({ twoFactorRequired: true, pendingToken: 'c1' });
    const ttl = +prisma.twoFaChallenge.create.mock.calls[0][0].data.expiresAt - before;
    expect(ttl).toBeGreaterThan(295_000);
    expect(ttl).toBeLessThanOrEqual(305_000);
  });
});

describe('auth.service - reset password userId tak dikenal (B-06)', () => {
  it('id tidak ada → 404, bukan 500 P2025', async () => {
    const tx: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('record not found'), { code: 'P2025' })),
      },
      session: { updateMany: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((cb: any) => cb(tx)) };
    const svc = new AuthService(prisma, {} as any, {} as any, { log: jest.fn() } as any);
    await expect(
      svc.resetPassword({ id: 'a1', role: 'ADMIN', division: '' }, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toThrow(NotFoundException);
    expect(tx.user.findUnique).toHaveBeenCalled();
  });
});
