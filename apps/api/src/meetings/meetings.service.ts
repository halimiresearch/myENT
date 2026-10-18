import { BadRequestException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OrgConfigService } from '../config/org-config.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RetentionService } from '../retention/retention.service';
import { LoanService } from '../loans/loan.service';
import { assertManualCancel, assertWindow, duplicateTimes } from './meeting.rules';
import { requireQrSecret } from '../common/jwt-secret';

// 1 hari dalam ms. Ditulis eksplisit — pernah typo separator menjadi 10 hari.
export const DAY_MS = 86400_000;

export interface MeetingInput {
  title: string;
  description?: string;
  startAt: Date;
  endAt: Date;
  attendanceOpenAt: Date;
  attendanceCloseAt: Date;
  latitude?: number | null;
  longitude?: number | null;
  radiusM?: number | null;
  recurrence?: 'NONE' | 'WEEKLY' | 'BIWEEKLY';
  recurrenceCount?: number;
}

@Injectable()
export class MeetingsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: OrgConfigService,
    private notif: NotificationsService,
  ) {}

  async create(actorId: string, dto: MeetingInput & { status?: 'DRAFT' | 'PUBLISHED' }) {
    assertWindow(dto);
    if (dto.recurrence && !['NONE', 'WEEKLY', 'BIWEEKLY'].includes(dto.recurrence))
      throw new BadRequestException('Recurrence hanya NONE/WEEKLY/BIWEEKLY');
    if (dto.recurrence && dto.recurrence !== 'NONE' && !(dto.recurrenceCount! >= 2 && dto.recurrenceCount! <= 52))
      throw new BadRequestException('recurrenceCount 2–52');
    const m = await this.prisma.$transaction(async (tx: any) => {
      const row = await tx.meeting.create({
        data: {
          title: dto.title,
          description: dto.description ?? '',
          startAt: dto.startAt,
          endAt: dto.endAt,
          attendanceOpenAt: dto.attendanceOpenAt,
          attendanceCloseAt: dto.attendanceCloseAt,
          status: dto.status ?? 'DRAFT',
          createdBy: actorId,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          radiusM: dto.radiusM ?? null,
          recurrence: dto.recurrence ?? 'NONE',
          recurrenceCount: dto.recurrence && dto.recurrence !== 'NONE' ? dto.recurrenceCount! : 0,
        },
      });
      await this.audit.log({ actorId, action: 'meeting.create', entity: 'Meeting', entityId: row.id }, tx);
      return row;
    });
    return m;
  }

  visibleWhere(role: string, status?: string) {
    return {
      deletedAt: null,
      ...(role === 'MEMBER' ? { status: { not: 'DRAFT' } } : {}),
      ...(status ? { status: status as any } : {}),
    };
  }

  async list(role: string, page: number, limit: number, status?: string) {
    const where = this.visibleWhere(role, status);
    const [total, data] = await Promise.all([
      this.prisma.meeting.count({ where }),
      this.prisma.meeting.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { startAt: 'asc' } }),
    ]);
    return { page, limit, total, data };
  }

  async getOrThrow(id: string, role: string) {
    const m = await this.prisma.meeting.findFirst({ where: { id, deletedAt: null } });
    if (!m || (role === 'MEMBER' && m.status === 'DRAFT')) throw new NotFoundException('Meeting tidak ditemukan');
    return m;
  }

  async update(actorId: string, isAdmin: boolean, id: string, dto: Partial<MeetingInput> & { status?: 'PUBLISHED' | 'CANCELLED' }) {
    const m = await this.prisma.meeting.findFirst({ where: { id, deletedAt: null } });
    if (!m) throw new NotFoundException('Meeting tidak ditemukan');
    if (dto.status === 'CANCELLED') assertManualCancel(m.status, isAdmin);
    if (dto.status === 'PUBLISHED' && m.status !== 'DRAFT')
      throw new ForbiddenException('Hanya DRAFT yang bisa dipublikasikan');
    if (dto.status && !['PUBLISHED', 'CANCELLED'].includes(dto.status))
      throw new ForbiddenException('Perubahan status manual hanya PUBLISHED/CANCELLED');
    const times = {
      startAt: dto.startAt ?? m.startAt,
      endAt: dto.endAt ?? m.endAt,
      attendanceOpenAt: dto.attendanceOpenAt ?? m.attendanceOpenAt,
      attendanceCloseAt: dto.attendanceCloseAt ?? m.attendanceCloseAt,
    };
    const timeChanged =
      +times.startAt !== +m.startAt || +times.endAt !== +m.endAt ||
      +times.attendanceOpenAt !== +m.attendanceOpenAt || +times.attendanceCloseAt !== +m.attendanceCloseAt;
    if (timeChanged) {
      if (m.finalizedAt) throw new ForbiddenException('Window terkunci setelah finalized; gunakan penyesuaian manual (§13)');
      assertWindow(times as any);
    }
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const u = await tx.meeting.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(timeChanged ? times : {}),
          ...(dto.status ? { status: dto.status } : {}),
          ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
          ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
          ...(dto.radiusM !== undefined ? { radiusM: dto.radiusM } : {}),
        },
      });
      await this.audit.log({
        actorId, action: 'meeting.update', entity: 'Meeting', entityId: id,
        oldValue: { status: m.status } as any, newValue: { status: u.status } as any,
      }, tx);
      return u;
    });
    if (dto.status === 'CANCELLED')
      await this.notif.broadcast(undefined, 'meeting-cancelled', `Kegiatan dibatalkan: ${m.title}`, '').catch(() => {});
    else if (timeChanged)
      await this.notif.broadcast(undefined, 'meeting-updated', `Jadwal berubah: ${m.title}`, '').catch(() => {});
    return updated;
  }

  async duplicate(actorId: string, id: string, newStartAt: Date) {
    const src = await this.prisma.meeting.findFirst({ where: { id, deletedAt: null } });
    if (!src) throw new NotFoundException('Meeting tidak ditemukan');
    if (!(newStartAt instanceof Date) || isNaN(+newStartAt)) throw new NotFoundException('startAt baru tidak valid');
    const times = duplicateTimes(src, newStartAt);
    assertWindow(times);
    // Hasil DRAFT tanpa attendance/request tersalin (PRD §8). Lokasi + recurrence ikut;
    // duplikat memulai serinya sendiri (parentId null) agar seri asli tak terpotong.
    const m = await this.prisma.$transaction(async (tx: any) => {
      const row = await tx.meeting.create({
        data: {
          title: src.title, description: src.description, ...times,
          status: 'DRAFT', createdBy: actorId,
          latitude: src.latitude, longitude: src.longitude, radiusM: src.radiusM,
          recurrence: src.recurrence, recurrenceCount: src.recurrenceCount,
        },
      });
      await this.audit.log({ actorId, action: 'meeting.duplicate', entity: 'Meeting', entityId: row.id, newValue: { from: id } as any }, tx);
      return row;
    });
    return m;
  }

  async remove(actorId: string, id: string) {    const m = await this.prisma.meeting.findFirst({ where: { id, deletedAt: null } });
    if (!m) throw new NotFoundException('Meeting tidak ditemukan');
    const attCount = await this.prisma.attendance.count({ where: { meetingId: id } });
    if (attCount > 0)
      throw new ForbiddenException('Meeting sudah memiliki attendance. Batalkan via status CANCELLED, bukan delete');
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const u = await tx.meeting.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.log({ actorId, action: 'meeting.delete', entity: 'Meeting', entityId: id }, tx);
      return u;
    });
    return { ok: true, deletedAt: updated.deletedAt };
  }

  // QR P2: token segar tiap generate, kedaluwarsa 5 menit.
  async qrFor(id: string) {
    const m = await this.prisma.meeting.findFirst({ where: { id, deletedAt: null } });
    if (!m) throw new NotFoundException('Meeting tidak ditemukan');
    const exp = Date.now() + 5 * 60_000;
    const { signQr } = await import('./qr.rules');
    const QRCode = (await import('qrcode')).default;
    const token = signQr(id, exp, requireQrSecret());
    return { qr: await QRCode.toDataURL(token), expiresAt: new Date(exp) };
  }

  // Satu tick transisi + finalisasi + reminder; idempotent via WHERE (AGENTS §12).
  // Transaction-level lock mencakup SEMUA langkah (KURANG.md §1): instance yang
  // kalah → { skipped: true } sebelum menyentuh apa pun. Broadcast keluar setelah commit.
  async tick(now = new Date()) {
    const mapping = await this.config.get<Record<string, string>>('approval_mapping');
    const notify: { type: string; title: string }[] = [];
    const r = await this.prisma.$transaction(async (tx: any) => {
      const lock = await tx.$queryRawUnsafe(
        `SELECT pg_try_advisory_xact_lock(hashtext('meeting-tick')) AS ok`,
      ).catch((e: any) => {
        console.error('[tick-lock-query-error]', e?.message ?? e);
        return [{ ok: false }];
      });
      if (!lock[0]?.ok) return null;
      const toOngoing = await tx.meeting.updateMany({
        where: { status: 'PUBLISHED', startAt: { lte: now }, deletedAt: null },
        data: { status: 'ONGOING' },
      });
      const toCompleted = await tx.meeting.updateMany({
        where: { status: 'ONGOING', endAt: { lte: now }, deletedAt: null },
        data: { status: 'COMPLETED' },
      });
      // Auto Alpha PRD §12: klaim per meeting via updateMany conditional —
      // instance kedua dapat count 0 → lewati (tanpa attendance ganda via unique + skipDuplicates).
      const due = await tx.meeting.findMany({
        where: {
          attendanceCloseAt: { lte: now }, finalizedAt: null, deletedAt: null,
          status: { in: ['PUBLISHED', 'ONGOING', 'COMPLETED'] },
        },
        select: { id: true, startAt: true, recurrence: true, recurrenceCount: true, recurrenceParentId: true },
      });
      let finalized = 0;
      for (const m of due) {
        const eligible = await tx.user.findMany({
          where: {
            status: 'ACTIVE', joinedAt: { lte: m.startAt },
            attendances: { none: { meetingId: m.id } },
          },
          select: { id: true },
        });
        if (eligible.length) {
          const approved = await tx.absenceRequest.findMany({
            where: { meetingId: m.id, status: 'APPROVED', userId: { in: eligible.map((u: any) => u.id) } },
            select: { userId: true, reasonType: true },
          });
          const map = new Map(approved.map((x: any) => [x.userId, (mapping as Record<string, string>)[x.reasonType]]));
          await tx.attendance.createMany({
            data: eligible.map((u: any) => ({
              userId: u.id, meetingId: m.id,
              status: map.get(u.id) ?? 'ABSENT',
              source: map.has(u.id) ? 'ABSENCE_APPROVAL' : 'AUTO_ALPHA',
              submittedAt: now,
            })),
            skipDuplicates: true,
          });
        }
        const fin = await tx.meeting.updateMany({ where: { id: m.id, finalizedAt: null }, data: { finalizedAt: now } });
        if (fin.count) {
          finalized++;
          await this.spawnRecurrenceTx(tx, m).catch((e: any) => {
            if (e?.code !== 'P2002') throw e; // anak kembar dari instance lain → abaikan.
          });
        }
      }
      // Reminder (PRD §15.4): klaim flag conditional, kirim setelah commit.
      const open = await tx.meeting.findMany({
        where: {
          status: { in: ['PUBLISHED', 'ONGOING'] }, deletedAt: null, notifOpenedSentAt: null,
          attendanceOpenAt: { lte: now }, attendanceCloseAt: { gte: now },
        },
        select: { id: true, title: true },
      });
      for (const m of open) {
        const claimed = await tx.meeting.updateMany({
          where: { id: m.id, notifOpenedSentAt: null }, data: { notifOpenedSentAt: now },
        });
        if (claimed.count) notify.push({ type: 'attendance-opened', title: m.title });
      }
      const closingAt = new Date(now.getTime() + 30 * 60_000);
      const closing = await tx.meeting.findMany({
        where: {
          status: { in: ['PUBLISHED', 'ONGOING'] }, deletedAt: null, notifClosingSentAt: null,
          attendanceCloseAt: { gte: now, lte: closingAt },
        },
        select: { id: true, title: true },
      });
      for (const m of closing) {
        const claimed = await tx.meeting.updateMany({
          where: { id: m.id, notifClosingSentAt: null }, data: { notifClosingSentAt: now },
        });
        if (claimed.count) notify.push({ type: 'attendance-closing', title: m.title });
      }
      return { toOngoing: toOngoing.count, toCompleted: toCompleted.count, finalized };
    }, { timeout: 30_000 });
    if (!r) return { skipped: true as const, toOngoing: 0, toCompleted: 0, finalized: 0 };
    for (const n of notify)
      await this.notif.broadcast(undefined, n.type, `${n.type === 'attendance-opened' ? 'Presensi dibuka' : 'Presensi hampir ditutup'}: ${n.title}`, '').catch(() => {});
    return { ...r };
  }

  // Backlog recurring (§22.3): anak selalu DRAFT untuk direview; unik per (parent, startAt)
  // sehingga dua instance tak bisa membuat anak kembar (KURANG.md §1).
  private async spawnRecurrenceTx(tx: any, m: { id: string; recurrence: string; recurrenceCount: number; recurrenceParentId: string | null }) {
    if ((m.recurrence !== 'WEEKLY' && m.recurrence !== 'BIWEEKLY') || m.recurrenceCount < 2) return;
    const rootId = m.recurrenceParentId ?? m.id;
    const series = await tx.meeting.findMany({
      where: { OR: [{ id: rootId }, { recurrenceParentId: rootId }], deletedAt: null },
      select: { id: true, startAt: true },
      orderBy: { startAt: 'desc' },
    });
    if (series.length >= m.recurrenceCount) return;
    const src = await tx.meeting.findUniqueOrThrow({ where: { id: series[0].id } });
    const next = new Date(src.startAt.getTime() + (src.recurrence === 'BIWEEKLY' ? 14 : 7) * DAY_MS);
    const times = duplicateTimes(src, next);
    await tx.meeting.create({
      data: {
        title: src.title, description: src.description, ...times,
        status: 'DRAFT', createdBy: src.createdBy,
        latitude: src.latitude, longitude: src.longitude, radiusM: src.radiusM,
        recurrence: src.recurrence, recurrenceCount: m.recurrenceCount, recurrenceParentId: rootId,
      },
    });
  }
}

// ponytail: setInterval in-process (single instance). Upgrade: advisory lock PG saat multi-instance (AGENTS §12).
@Injectable()
export class MeetingJob implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(
    private meetings: MeetingsService,
    private retention: RetentionService,
    private loans: LoanService,
  ) {}
  onModuleInit() {
    // Interval tak valid (NaN/negatif/kecil) → default aman, jangan storm tick.
    let ms = Number(process.env.MEETING_TICK_MS ?? 60_000);
    if (!Number.isFinite(ms) || ms < 1000) ms = 60_000;
    this.timer = setInterval(
      () =>
        (async () => {
          // Guard in-process: interval berikut dilewati bila tick sebelumnya belum selesai.
          // Cross-instance dijaga xact lock di tick() (AGENTS §12).
          if (this.running) return;
          this.running = true;
          try {
            const r = await this.meetings.tick();
            if ((r as any).skipped) return;
            await this.retention.tick();
            await this.loans.overdueTick();
          } finally {
            this.running = false;
          }
        })().catch((e) => console.error('[meeting-tick]', e)),
      ms,
    );
    this.timer.unref?.();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
