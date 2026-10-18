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
