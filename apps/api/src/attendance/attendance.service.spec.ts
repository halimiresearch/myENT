import { ForbiddenException } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

function makeSvc(target: any) {
  const tx: any = {
    attendance: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      update: jest.fn(),
    },
  };
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(target) },
    meeting: { findFirst: jest.fn().mockResolvedValue({ id: 'm1' }) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const notif = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const svc = new AttendanceService(prisma, {} as any, { log: jest.fn() } as any, notif as any, {} as any, {} as any);
  return { svc, prisma, tx };
}

describe('attendance.service - adjust scope (B-01.3)', () => {
  const officer = { id: 'o1', role: 'OFFICER', division: 'Foto' };

  it('OFFICER tidak boleh menyesuaikan kehadiran sendiri', async () => {
    const { svc } = makeSvc({ id: 'o1', division: 'Foto' });
    await expect(svc.adjust(officer, 'm1', 'o1', 'PRESENT', 'alasan')).rejects.toThrow(ForbiddenException);
  });

  it('OFFICER divisi lain ditolak', async () => {
    const { svc } = makeSvc({ id: 'mb1', division: 'Jurnalistik' });
    await expect(svc.adjust(officer, 'm1', 'mb1', 'PRESENT', 'alasan')).rejects.toThrow(ForbiddenException);
  });

  it('OFFICER se-divisi boleh', async () => {
    const { svc, tx } = makeSvc({ id: 'mb1', division: 'Foto' });
    const r = await svc.adjust(officer, 'm1', 'mb1', 'PRESENT', 'alasan');
    expect(r.id).toBe('a1');
    expect(tx.attendance.create).toHaveBeenCalled();
  });

  it('ADMIN bebas (divisi lain)', async () => {
    const { svc, tx } = makeSvc({ id: 'mb1', division: 'Jurnalistik' });
    await svc.adjust({ id: 'a1', role: 'ADMIN', division: '' }, 'm1', 'mb1', 'SICK', 'alasan');
    expect(tx.attendance.create).toHaveBeenCalled();
  });
});
