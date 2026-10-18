import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/all-exceptions.filter';
import { MeetingsService } from '../src/meetings/meetings.service';
import { totp } from '../src/auth/totp';

// Regression hardening KURANG.md §10: concurrency + validation + replay.
// Butuh DATABASE_URL (postgres). Data unik per run; berbagi DB dengan suite lain.
describe('hardening concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let svc: MeetingsService;
  let adminT: string;
  let div: string;
  const uniq = () => `${Date.now()}${Math.floor(Math.random() * 100000)}`;

  async function mkUser(nim: string, role: string, division: string, pass = 'MemberPass123!') {
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminT}`)
      .send({ nim, name: `E2E ${nim}`, password: pass, role, division })
      .expect(201);
    const r = await request(app.getHttpServer()).post('/auth/login').send({ nim, password: pass }).expect(200);
    return r.body.accessToken as string;
  }

  async function mkMeeting(token: string, title: string, openOff: number, closeOff: number, extra: any = {}) {
    const now = Date.now();
    const m = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title,
        startAt: new Date(now + openOff - 3600_1000).toISOString(),
        endAt: new Date(now + closeOff).toISOString(),
        attendanceOpenAt: new Date(now + openOff).toISOString(),
        attendanceCloseAt: new Date(now + closeOff).toISOString(),
        status: 'PUBLISHED',
        ...extra,
      })
      .expect(201);
    return m.body.id as string;
  }

  beforeAll(async () => {
    process.env.MEETING_TICK_MS = '3600000';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
    svc = app.get(MeetingsService);
    const nim = `ah${uniq()}`;
    await prisma.user.create({
      data: { nim, name: 'E2E Admin', passwordHash: await bcrypt.hash('AdminPass123!', 10), role: 'ADMIN' },
    });
    adminT = (await request(app.getHttpServer()).post('/auth/login').send({ nim, password: 'AdminPass123!' })).body.accessToken;
    div = `H${Date.now() % 100000}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('concurrent tick: satu finalize, satu recurring child, tanpa alpha ganda', async () => {
    const off = await mkUser(`ho${uniq()}`, 'OFFICER', div);
    const memNim = `hm${uniq()}`;
    const memT = await mkUser(memNim, 'MEMBER', div);
    const mem = await prisma.user.findUniqueOrThrow({ where: { nim: memNim } });
    // Simulasi anggota lama: eligible alpha bila joined sebelum meeting mulai.
    await prisma.user.update({ where: { id: mem.id }, data: { joinedAt: new Date(Date.now() - 30 * 86400_1000) } });
    const title = `Recur ${uniq()}`;
    // Window sudah lewat + recurring 2 seri.
    const mid = await mkMeeting(off, title, -7200_1000, -3600_1000, { recurrence: 'WEEKLY', recurrenceCount: 2 });
    const [a, b] = await Promise.all([svc.tick(), svc.tick()]);
    const done = [a, b].filter((r: any) => !(r as any).skipped);
    expect(done.length).toBeGreaterThanOrEqual(1);
    const root = await prisma.meeting.findUniqueOrThrow({ where: { id: mid } });
    expect(root.finalizedAt).not.toBeNull();
    expect(await prisma.meeting.count({ where: { recurrenceParentId: mid } })).toBe(1);
    expect(await prisma.attendance.count({ where: { meetingId: mid, userId: mem.id } })).toBe(1);
    void memT;
  });

  it('concurrent tick: reminder klaim sekali per member', async () => {
    const off = await mkUser(`hr${uniq()}`, 'OFFICER', div);
    const memNim = `hn${uniq()}`;
    await mkUser(memNim, 'MEMBER', div);
    const mem = await prisma.user.findUniqueOrThrow({ where: { nim: memNim } });
    const title = `Remind ${uniq()}`;
    // Window terbuka sekarang + tutup 10 mnt lagi → kedua reminder menyala.
    await mkMeeting(off, title, -600_000, 600_000);
    await Promise.all([svc.tick(), svc.tick()]);
    expect(
      await prisma.notification.count({ where: { userId: mem.id, type: 'attendance-opened', title: { contains: title } } }),
    ).toBe(1);
    expect(
      await prisma.notification.count({ where: { userId: mem.id, type: 'attendance-closing', title: { contains: title } } }),
    ).toBe(1);
  });

  it('concurrent absence approve: satu 200 satu 400, satu attendance', async () => {
    const off1 = await mkUser(`ha${uniq()}`, 'OFFICER', div);
    const off2 = await mkUser(`hb${uniq()}`, 'OFFICER', div);
    const memNim = `hc${uniq()}`;
    const memT = await mkUser(memNim, 'MEMBER', div);
    const mem = await prisma.user.findUniqueOrThrow({ where: { nim: memNim } });
    const mid = await mkMeeting(off1, `Abs ${uniq()}`, -600_1000, 3600_1000);
    const req = await request(app.getHttpServer())
      .post(`/meetings/${mid}/absence-requests`)
      .set('Authorization', `Bearer ${memT}`)
      .field('reasonType', 'SICK')
      .expect(201);
    const srv = request(app.getHttpServer());
    const [r1, r2] = await Promise.all([
      srv.patch(`/absence-requests/${req.body.id}/approve`).set('Authorization', `Bearer ${off1}`).send({ reviewNote: 'a' }),
      srv.patch(`/absence-requests/${req.body.id}/approve`).set('Authorization', `Bearer ${off2}`).send({ reviewNote: 'b' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    const claim = await prisma.absenceRequest.findUniqueOrThrow({ where: { id: req.body.id } });
    expect(claim.status).toBe('APPROVED');
    expect(await prisma.attendance.count({ where: { meetingId: mid, userId: mem.id } })).toBe(1);
  });

  it('concurrent correction approve: atomic, satu PRESENT', async () => {
    const off1 = await mkUser(`hx${uniq()}`, 'OFFICER', div);
    const off2 = await mkUser(`hy${uniq()}`, 'OFFICER', div);
    const memNim = `hz${uniq()}`;
    const memT = await mkUser(memNim, 'MEMBER', div);
    const mem = await prisma.user.findUniqueOrThrow({ where: { nim: memNim } });
    const mid = await mkMeeting(off1, `Cor ${uniq()}`, -7200_1000, -3600_1000);
    const claim = await request(app.getHttpServer())
      .post(`/meetings/${mid}/corrections`)
      .set('Authorization', `Bearer ${memT}`)
      .field('claim', 'Sebenarnya hadir tapi lupa presensi HP mati')
      .expect(201);
    const srv = request(app.getHttpServer());
    const [r1, r2] = await Promise.all([
      srv.patch(`/corrections/${claim.body.id}/approve`).set('Authorization', `Bearer ${off1}`).send({ reviewNote: 'a' }),
      srv.patch(`/corrections/${claim.body.id}/approve`).set('Authorization', `Bearer ${off2}`).send({ reviewNote: 'b' }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 400]);
    const done = await prisma.correctionRequest.findUniqueOrThrow({ where: { id: claim.body.id } });
    expect(done.status).toBe('APPROVED');
    const att = await prisma.attendance.findMany({ where: { meetingId: mid, userId: mem.id } });
    expect(att.length).toBe(1);
    expect(att[0].status).toBe('PRESENT');
    expect(att[0].source).toBe('MANUAL');
  });

  it('2FA challenge: replay + konkuren hanya satu sukses', async () => {
    const nim = `h2${uniq()}`;
    const pass = 'TotpPass123!';
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminT}`)
      .send({ nim, name: 'E2E 2FA', password: pass })
      .expect(201);
    let r = await request(app.getHttpServer()).post('/auth/login').send({ nim, password: pass }).expect(200);
    const setup = await request(app.getHttpServer()).post('/auth/2fa/setup').set('Authorization', `Bearer ${r.body.accessToken}`).send({ password: pass }).expect(201);
    await request(app.getHttpServer())
      .post('/auth/2fa/enable')
      .set('Authorization', `Bearer ${r.body.accessToken}`)
      .send({ code: String(totp(setup.body.secret)).padStart(6, '0') })
      .expect(201);
    // Replay: pakai challenge yang sama dua kali.
    r = await request(app.getHttpServer()).post('/auth/login').send({ nim, password: pass }).expect(200);
    const code = String(totp(setup.body.secret)).padStart(6, '0');
    await request(app.getHttpServer()).post('/auth/2fa/verify').send({ pendingToken: r.body.pendingToken, code }).expect(200);
    await request(app.getHttpServer()).post('/auth/2fa/verify').send({ pendingToken: r.body.pendingToken, code }).expect(401);
    // Konkuren: satu challenge, dua verifikasi bersamaan.
    r = await request(app.getHttpServer()).post('/auth/login').send({ nim, password: pass }).expect(200);
    const code2 = String(totp(setup.body.secret)).padStart(6, '0');
    const srv = request(app.getHttpServer());
    const [v1, v2] = await Promise.all([
      srv.post('/auth/2fa/verify').send({ pendingToken: r.body.pendingToken, code: code2 }),
      srv.post('/auth/2fa/verify').send({ pendingToken: r.body.pendingToken, code: code2 }),
    ]);
    expect([v1.status, v2.status].sort()).toEqual([200, 401]);
  });

  it('forgot-password konkuren: satu token aktif; token lama invalid', async () => {
    const nim = `hf${uniq()}`;
    const email = `hf${uniq()}@test.id`;
    const mem = await prisma.user.create({
      data: { nim, name: 'E2E Forgot', email, passwordHash: await bcrypt.hash('ForgotPass123!', 10), role: 'MEMBER' },
    });
    const srv = request(app.getHttpServer());
    await Promise.all([
      srv.post('/auth/forgot-password').send({ nim }),
      srv.post('/auth/forgot-password').send({ nim }),
      srv.post('/auth/forgot-password').send({ nim }),
    ]);
    const active = (u: string) =>
      prisma.passwordReset.count({ where: { userId: u, usedAt: null, expiresAt: { gt: new Date() } } });
    expect(await active(mem.id)).toBe(1);
    await srv.post('/auth/forgot-password').send({ nim }).expect(200);
    expect(await active(mem.id)).toBe(1);
    // Token kedaluwarsa ditolak (hash asli + expires lampau → benar-benar jalur expiry).
    const raw = randomBytes(32).toString('hex');
    const digest = createHash('sha256').update(raw).digest('hex');
    await prisma.passwordReset.create({
      data: { userId: mem.id, tokenHash: digest, expiresAt: new Date(Date.now() - 1000) },
    });
    await srv.post('/auth/reset-via-email').send({ token: raw, newPassword: 'BaruPass123!' }).expect(401);
  });

  it('config: mapping tak lengkap/kunci asing/nilai salah/absent efektif → 400', async () => {
    const srv = request(app.getHttpServer());
    const hdr = { Authorization: `Bearer ${adminT}` };
    const full = {
      SICK: 'SICK', ACADEMIC: 'PERMITTED', BEREAVEMENT: 'PERMITTED',
      ORGANIZATION: 'PERMITTED', DISPENSATION: 'DISPENSATION', OTHER: 'PERMITTED',
    };
    const bad = { ...full };
    delete (bad as any).OTHER;
    await srv.patch('/config').set(hdr).send({ key: 'approval_mapping', value: bad }).expect(400);
    await srv.patch('/config').set('Authorization', `Bearer ${adminT}`).send({ key: 'approval_mapping', value: { ...full, HACK: 'SICK' } }).expect(400);
    await srv.patch('/config').set('Authorization', `Bearer ${adminT}`).send({ key: 'approval_mapping', value: { ...full, SICK: 'ABSENT' } }).expect(400);
    await srv.patch('/config').set('Authorization', `Bearer ${adminT}`).send({ key: 'effective_statuses', value: ['PRESENT', 'ABSENT'] }).expect(400);
    await srv.patch('/config').set('Authorization', `Bearer ${adminT}`).send({ key: 'unknown_key_xyz', value: 1 }).expect(400);
    // Kembalikan default agar suite lain tak terpengaruh.
    await srv.patch('/config').set('Authorization', `Bearer ${adminT}`).send({ key: 'approval_mapping', value: full }).expect(200);
    await srv.patch('/config').set('Authorization', `Bearer ${adminT}`).send({ key: 'effective_statuses', value: ['PRESENT', 'PERMITTED', 'SICK', 'DISPENSATION'] }).expect(200);
  });
});
