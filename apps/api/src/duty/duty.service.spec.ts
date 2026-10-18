import { BadRequestException } from '@nestjs/common';
import { DutyService } from './duty.service';

function makeSvc() {
  const tx: any = {
    meeting: { create: jest.fn((args: any) => ({ id: 'm1', ...args.data })) },
    dutyAssignment: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma: any = {
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u1' }, { id: 'u2' }]) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const audit = { log: jest.fn() };
  const svc = new DutyService(prisma, audit as any);
  return { svc, prisma, tx, audit };
}

const adm = { id: 'admin1', role: 'ADMIN', division: '' };
const off = { id: 'off1', role: 'OFFICER', division: 'Foto' };
const start = new Date('2026-11-01T00:00:00Z');

describe('duty.service - B-03 (jam WIB)', () => {
  it('06:00/22:00 = 06:00/22:00 WIB tersimpan sebagai UTC; title = tanggal diminta', async () => {
    const { svc, tx } = makeSvc();
    const r = await svc.generate(adm, { startDate: start, days: 1, perDay: 2 });
    expect(r.meetings).toBe(1);
    const data = tx.meeting.create.mock.calls[0][0].data;
    expect(data.title).toBe('Piket 2026-11-01');
    expect(data.startAt.toISOString()).toBe('2026-10-31T23:00:00.000Z'); // 06:00 WIB
    expect(data.endAt.toISOString()).toBe('2026-11-01T15:00:00.000Z'); // 22:00 WIB
    expect(+data.attendanceOpenAt).toBe(+data.startAt);
    expect(+data.attendanceCloseAt).toBe(+data.endAt);
  });

  it('openTime >= closeTime ditolak sebelum transaksi', async () => {
    const { svc, prisma } = makeSvc();
    await expect(
      svc.generate(adm, { startDate: start, days: 1, openTime: '22:00', closeTime: '06:00' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('openTime == closeTime juga ditolak', async () => {
    const { svc, prisma } = makeSvc();
    await expect(
      svc.generate(adm, { startDate: start, days: 1, openTime: '06:00', closeTime: '06:00' }),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('duty.service - C2 (scope divisi roster)', () => {
  it('officer yang minta divisi lain tetap dikunci ke divisinya', async () => {
    const { svc, prisma, audit } = makeSvc();
    await svc.generate(off, { startDate: start, days: 1, division: 'Jurnalistik' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE', division: 'Foto' } }));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ newValue: expect.objectContaining({ division: 'Foto' }) }),
      expect.anything(),
    );
  });

  it('officer tanpa division tetap dikunci ke divisinya', async () => {
    const { svc, prisma } = makeSvc();
    await svc.generate(off, { startDate: start, days: 1 });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE', division: 'Foto' } }));
  });

  it('admin tetap bebas memilih divisi', async () => {
    const { svc, prisma } = makeSvc();
    await svc.generate(adm, { startDate: start, days: 1, division: 'Jurnalistik' });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE', division: 'Jurnalistik' } }));
  });

  it('admin tanpa divisi = semua divisi (tanpa filter)', async () => {
    const { svc, prisma } = makeSvc();
    await svc.generate(adm, { startDate: start, days: 1 });
    expect(prisma.user.findMany.mock.calls[0][0].where.division).toBeUndefined();
  });
});
