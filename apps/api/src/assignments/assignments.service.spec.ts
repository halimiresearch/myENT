import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

describe('assignments.service - lampiran tugas (B-17)', () => {
  const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n0\n%%EOF');

  function makeCreateSvc() {
    const tx: any = { assignment: { create: jest.fn().mockResolvedValue({ id: 'a1' }) } };
    const prisma: any = {
      meeting: { findFirst: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(tx)),
    };
    const storage = { save: jest.fn().mockResolvedValue('k'), remove: jest.fn(), signedUrl: jest.fn().mockResolvedValue('http://signed') };
    const notif = { broadcast: jest.fn().mockResolvedValue({ count: 0 }) };
    const config = { get: jest.fn().mockResolvedValue(10) };
    const svc = new AssignmentsService(prisma, storage as any, { log: jest.fn() } as any, notif as any, config as any);
    return { svc, storage };
  }

  it('create lampiran PDF → key berakhiran .pdf (content-type lokal benar)', async () => {
    const { svc, storage } = makeCreateSvc();
    await svc.create('o1', 'Tugas', '', undefined, new Date(Date.now() + 86400_000), PDF);
    expect(storage.save.mock.calls[0][0]).toMatch(/^assignments\/[0-9a-f-]+\.pdf$/);
  });

  it('attachmentUrl: lampiran ada → signedUrl', async () => {
    const prisma: any = { assignment: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', attachmentKey: 'assignments/x.pdf' }) } };
    const storage = { signedUrl: jest.fn().mockResolvedValue('http://signed') };
    const svc = new AssignmentsService(prisma, storage as any, {} as any, {} as any, {} as any);
    await expect(svc.attachmentUrl('a1', 'http://b')).resolves.toEqual({ url: 'http://signed' });
    expect(storage.signedUrl).toHaveBeenCalledWith('assignments/x.pdf', 'http://b');
  });

  it('attachmentUrl: tanpa lampiran / tugas tidak ada → 404', async () => {
    const prisma: any = { assignment: { findUnique: jest.fn().mockResolvedValue({ id: 'a1', attachmentKey: null }) } };
    const svc = new AssignmentsService(prisma, {} as any, {} as any, {} as any, {} as any);
    await expect(svc.attachmentUrl('a1', 'http://b')).rejects.toThrow(NotFoundException);
  });
});
