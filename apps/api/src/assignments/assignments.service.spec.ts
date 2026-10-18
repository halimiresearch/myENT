import { ForbiddenException } from '@nestjs/common';
import { AssignmentsService } from './assignments.service';

function makeSvc(sub: any) {
  const tx: any = {
    submission: { update: jest.fn().mockResolvedValue({ id: sub.id, reviewedAt: new Date(), reviewNote: 'ok' }) },
  };
  const prisma: any = {
    submission: { findUnique: jest.fn().mockResolvedValue(sub) },
    $transaction: jest.fn((cb: any) => cb(tx)),
  };
  const svc = new AssignmentsService(prisma, {} as any, { log: jest.fn() } as any, {} as any, {} as any);
  return { svc, prisma, tx };
}

describe('assignments.service - scope review (B-01.1)', () => {
  const base = { id: 's1', userId: 'mb1', reviewedAt: null, objectKey: 'k', submittedAt: new Date(), assignmentId: 'a1' };

  it('OFFICER divisi lain ditolak', async () => {
    const { svc, tx } = makeSvc({ ...base, user: { id: 'mb1', division: 'Jurnalistik' } });
    await expect(svc.review({ id: 'o1', role: 'OFFICER', division: 'Foto' }, 's1', 'oke')).rejects.toThrow(ForbiddenException);
    expect(tx.submission.update).not.toHaveBeenCalled();
  });

  it('OFFICER se-divisi boleh', async () => {
    const { svc, tx } = makeSvc({ ...base, user: { id: 'mb1', division: 'Foto' } });
    await svc.review({ id: 'o1', role: 'OFFICER', division: 'Foto' }, 's1', 'oke');
    expect(tx.submission.update).toHaveBeenCalled();
  });

  it('OFFICER tidak boleh review submission sendiri', async () => {
    const { svc } = makeSvc({ ...base, userId: 'o1', user: { id: 'o1', division: 'Foto' } });
    await expect(svc.review({ id: 'o1', role: 'OFFICER', division: 'Foto' }, 's1', '')).rejects.toThrow(ForbiddenException);
  });
});
