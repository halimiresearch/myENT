import { ForbiddenException } from '@nestjs/common';
import { LoanService } from './loan.service';

function makeSvc(loan: any, borrower: any) {
  const tx: any = {
    loan: { update: jest.fn().mockResolvedValue({ id: loan.id, status: 'RETURNED' }) },
    item: { update: jest.fn().mockResolvedValue({}) },
    itemHistory: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    loan: { findUnique: jest.fn().mockResolvedValue(loan) },
    user: { findUnique: jest.fn().mockResolvedValue(borrower) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const storage = { save: jest.fn().mockResolvedValue(undefined), remove: jest.fn() };
  const notif = { notifyUsers: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockResolvedValue(5) };
  const svc = new LoanService(prisma, { log: jest.fn() } as any, storage as any, notif as any, config as any);
  return { svc, prisma, tx, storage };
}

describe('loan.service - scope returnLoan (B-01.4)', () => {
  const loan = { id: 'l1', borrowerId: 'mb1', itemId: 'i1', status: 'ACTIVE' };
  const officer = { id: 'o1', role: 'OFFICER', division: 'Foto' };

  it('OFFICER divisi lain ditolak, foto tidak disimpan', async () => {
    const { svc, storage } = makeSvc(loan, { id: 'mb1', division: 'Jurnalistik' });
    await expect(svc.returnLoan(officer, 'l1', Buffer.from('x'), '', false)).rejects.toThrow(ForbiddenException);
    expect(storage.save).not.toHaveBeenCalled();
  });

  it('OFFICER se-divisi boleh', async () => {
    const { svc, storage } = makeSvc(loan, { id: 'mb1', division: 'Foto' });
    (svc as any).cleanPhoto = jest.fn().mockResolvedValue(Buffer.from('clean'));
    const r = await svc.returnLoan(officer, 'l1', Buffer.from('x'), 'oke', false);
    expect(r.status).toBe('RETURNED');
    expect(storage.save).toHaveBeenCalled();
  });

  it('peminjam sendiri boleh mengembalikan', async () => {
    const { svc } = makeSvc(loan, { id: 'mb1', division: 'Jurnalistik' });
    (svc as any).cleanPhoto = jest.fn().mockResolvedValue(Buffer.from('clean'));
    const r = await svc.returnLoan({ id: 'mb1', role: 'OFFICER', division: 'Jurnalistik' }, 'l1', Buffer.from('x'), '', false);
    expect(r.status).toBe('RETURNED');
  });
});
