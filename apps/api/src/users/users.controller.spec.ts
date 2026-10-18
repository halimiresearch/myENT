import { ConflictException } from '@nestjs/common';
import { UsersController } from './users.controller';

function make() {
  const prisma: any = {
    user: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const c = new UsersController(prisma, audit as any);
  return { c, prisma };
}

describe('users.controller - import scope divisi (B-01.2)', () => {
  const csv = 'nim,nama,divisi,angkatan\n202699901,Budi,Jurnalistik,2026';

  it('OFFICER: divisi CSV diabaikan, dipaksa divisi aktor', async () => {
    const { c, prisma } = make();
    const r = await c.import({ user: { id: 'o1', role: 'OFFICER', division: 'Foto' } }, { csv });
    expect(r.total).toBe(1);
    expect(prisma.user.createMany.mock.calls[0][0].data[0].division).toBe('Foto');
  });

  it('ADMIN: divisi dari CSV dipertahankan', async () => {
    const { c, prisma } = make();
    await c.import({ user: { id: 'a1', role: 'ADMIN', division: '' } }, { csv });
    expect(prisma.user.createMany.mock.calls[0][0].data[0].division).toBe('Jurnalistik');
  });
});

describe('users.controller - input wajar bukan 500 (B-06)', () => {
  it('NIM duplikat saat create → 409', async () => {
    const prisma: any = { $transaction: jest.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })) };
    const c = new UsersController(prisma, { log: jest.fn() } as any);
    await expect(
      c.create({ user: { id: 'a1', role: 'ADMIN', division: '' } }, { nim: '20260001', name: 'Budi', password: 'Password123!' }),
    ).rejects.toThrow(ConflictException);
  });

  it('import balapan: baris yang di-skip dilaporkan failed + audit pakai count nyata', async () => {
    let created: any[] = [];
    const prisma: any = {
      user: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([]) // cek awal: belum ada
          .mockImplementationOnce(async () => created.slice(0, 1).map((d) => ({ nim: d.nim, passwordHash: d.passwordHash }))), // hanya 1 yang benar-benar masuk dengan hash kita
        createMany: jest.fn().mockImplementation(async ({ data }: any) => {
          created = data;
          return { count: 1 };
        }),
      },
    };
    const audit = { log: jest.fn() };
    const c = new UsersController(prisma, audit as any);
    const csv2 = 'nim,nama,divisi,angkatan\n202690001,A,Jurnalistik,2026\n202690002,B,Jurnalistik,2026';
    const r = await c.import({ user: { id: 'o1', role: 'OFFICER', division: 'Foto' } }, { csv: csv2 });
    expect(r.results).toEqual([
      { nim: '202690001', status: 'ok', temporaryPassword: expect.any(String) },
      { nim: '202690002', status: 'failed', reason: expect.stringContaining('duplikat') },
    ]);
    expect(audit.log.mock.calls[0][0].newValue.count).toBe(1);
  });
});
