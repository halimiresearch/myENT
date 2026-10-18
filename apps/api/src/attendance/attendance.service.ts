import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgConfigService } from '../config/org-config.service';
import { assertSelfWindow, detectImage, selfieKey } from './attendance.rules';
import { assertInside } from './location';
import { canManageMember, divisionScope } from '../common/policy';
import { AttendanceStatsService } from './attendance-stats.service';

@Injectable()
export class AttendanceService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
    private notif: NotificationsService,
    private config: OrgConfigService,
    private stats: AttendanceStatsService,
  ) {}

  async createSelf(userId: string, meetingId: string, file: Buffer, loc?: { latitude?: number; longitude?: number }) {
    if (!file?.length) throw new BadRequestException('Selfie wajib');
    // PRD §17: consent sebelum selfie pertama — disimpan server, tak bisa dipalsukan client.
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { privacyConsentedAt: true } });
    if (!u?.privacyConsentedAt)
      throw new ForbiddenException('PRIVACY_CONSENT_REQUIRED: setujui pemberitahuan privasi sebelum presensi selfie');
    const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null } });
    if (!m || m.status === 'DRAFT') throw new NotFoundException('Meeting tidak ditemukan');
    const now = new Date(); // BR-02: waktu server, bukan client.
    assertSelfWindow(m, now);
    assertInside(m, loc ?? {});
    const maxMb = await this.config.get<number>('max_upload_mb');
    if (file.length > maxMb * 1024 * 1024) throw new BadRequestException(`Maksimal ${maxMb} MB`);
    if (!detectImage(file)) throw new BadRequestException('File harus foto JPG/PNG/WebP');
    // Re-encode → EXIF (termasuk lokasi) terbuang (PRD §10). Output selalu JPEG.
    // ponytail: resize 1920 + pixel cap anti-bom dekompresi. Ceiling: queue/worker saat traffic tinggi.
    const clean = await sharp(file, { limitInputPixels: 25_000_000 }).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
    const key = selfieKey(now, randomUUID());
    await this.storage.save(key, clean, 'image/jpeg');
    try {
      const a = await this.prisma.$transaction(async (tx: any) => {
        const row = await tx.attendance.create({
          data: { userId, meetingId, status: 'PRESENT', source: 'SELF', selfieObjectKey: key, submittedAt: now },
        });
        // BR-15 PRESENT menang: request PENDING miliknya otomatis CANCELLED.
        await tx.absenceRequest.updateMany({
          where: { userId, meetingId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        return row;
      });
      return a;
    } catch (e: any) {
      await this.storage.remove(key); // jangan tinggalkan file yatim.
      if (e?.code === 'P2002') throw new ConflictException('Sudah presensi'); // BR-01; milik sendiri = sukses (AGENTS §5)
      throw e;
    }
  }

  async myOne(userId: string, meetingId: string) {
    const a = await this.prisma.attendance.findUnique({
      where: { userId_meetingId: { userId, meetingId } },
      include: { meeting: { select: { id: true, title: true, startAt: true } } },
    });
    if (!a) throw new NotFoundException('Belum presensi');
    return a;
  }

  async myList(userId: string, page: number, limit: number) {
    const where = { userId };
    const [total, data] = await Promise.all([
      this.prisma.attendance.count({ where }),
      this.prisma.attendance.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { submittedAt: 'desc' },
        include: { meeting: { select: { id: true, title: true, startAt: true } } },
      }),
    ]);
    return { page, limit, total, data };
  }

  async listByMeeting(actor: { role: string; division: string }, meetingId: string, page: number, limit: number) {
    const where: any = {
      meetingId,
      ...(actor.role === 'ADMIN' ? {} : { user: { division: actor.division } }),
    };
    const [total, data] = await Promise.all([
      this.prisma.attendance.count({ where }),
      this.prisma.attendance.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { submittedAt: 'asc' },
        include: { user: { select: { id: true, nim: true, name: true } } },
      }),
    ]);
    return { page, limit, total, data };
  }

  // BR-17: penyesuaian manual, alasan wajib, diaudit. Berlaku kapan pun termasuk finalized (PRD §13).
  // db+silent: gabung ke transaksi pemanggil (correction approve) — notif dikirim pemanggil setelah commit.
  async adjust(actor: { id: string; role: string; division: string }, meetingId: string, targetUserId: string, status: string, reason: string, db?: any, silent = false) {
    if (!reason?.trim()) throw new BadRequestException('Alasan wajib diisi');
    if (!['PRESENT', 'PERMITTED', 'SICK', 'DISPENSATION', 'ABSENT'].includes(status))
      throw new BadRequestException('Status tidak valid');
    const actorId = actor.id;
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true, division: true } });
    if (!target) throw new NotFoundException('User tidak ditemukan');
    if (actor.id === target.id) throw new ForbiddenException('Tidak boleh menyesuaikan kehadiran sendiri');
    if (!canManageMember(actor as any, target as any)) throw new ForbiddenException('Di luar divisi Anda');
    const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null } });
    if (!m) throw new NotFoundException('Meeting tidak ditemukan');
    const now = new Date();
    const run = async (tx: any) => {
      const before = await tx.attendance.findUnique({
        where: { userId_meetingId: { userId: targetUserId, meetingId } },
      });
      const data = {
        status: status as any, source: 'MANUAL' as const,
        adjustedAt: now, adjustmentReason: reason, note: '',
      };
      const a = before
        ? await tx.attendance.update({ where: { id: before.id }, data })
        : await tx.attendance.create({
            data: { userId: targetUserId, meetingId, submittedAt: now, ...data },
          });
      await this.audit.log({
        actorId, action: 'attendance.adjust', entity: 'Attendance', entityId: a.id,
        oldValue: (before?.status ?? null) as any, newValue: { status } as any, reason,
      }, tx);
      if (!silent)
        await this.notif
          .notifyUsers([targetUserId], 'attendance-adjusted', `Kehadiran dikoreksi pengurus`, reason,
            { refType: 'Attendance', refId: a.id })
          .catch(() => {});
      return a;
    };
    if (db) return run(db);
    return this.prisma.$transaction((tx: any) => run(tx));
  }
  async selfieUrl(reqUser: any, attendanceId: string, baseUrl: string) {
    const a = await this.prisma.attendance.findUnique({ where: { id: attendanceId } });
    if (!a) throw new NotFoundException('Tidak ditemukan');
    if (reqUser.role === 'MEMBER' && a.userId !== reqUser.id) throw new NotFoundException('Tidak ditemukan');
    if (reqUser.role === 'OFFICER' && a.userId !== reqUser.id) {
      const target = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { id: true, division: true } });
      if (!target || !canManageMember(reqUser, target)) throw new NotFoundException('Tidak ditemukan');
    }
    if (!a.selfieObjectKey || a.selfieDeletedAt) throw new GoneException('File sudah dihapus');
    return { url: await this.storage.signedUrl(a.selfieObjectKey, baseUrl) };
  }

  private countedWhere(from?: Date, to?: Date): any {
    // Piket dikecualikan dari % rekap rapat (punya ringkasan sendiri).
    return {
      meeting: {
        finalizedAt: { not: null }, status: { not: 'CANCELLED' }, deletedAt: null, isDuty: false,
        ...(from || to ? { startAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
    };
  }

  // Rekap pribadi (PRD §14.2–14.3): hanya milik sendiri; koreksi MANUAL terlihat + alasannya (BR-21).
  async recapMe(userId: string) {    const rows = await this.prisma.attendance.findMany({
      where: { userId, ...this.countedWhere() },
      include: { meeting: { select: { id: true, title: true, startAt: true, isDuty: true } } },
      orderBy: { submittedAt: 'desc' },
    });
    const by: Record<string, number> = { PRESENT: 0, PERMITTED: 0, SICK: 0, DISPENSATION: 0, ABSENT: 0 };
    for (const r of rows) by[r.status]++;
    const effective = await this.stats.countEffective(by);
    const pctVal = this.stats.pct(effective, rows.length);
    const threshold = await this.config.get<number | null>('attendance_threshold_pct');
    return {
      counted: rows.length, present: by.PRESENT, permitted: by.PERMITTED, sick: by.SICK,
      dispensation: by.DISPENSATION, absent: by.ABSENT, percentage: pctVal,
      belowThreshold: threshold != null && pctVal !== null && pctVal < threshold,
      history: rows.map((r) => ({
        meeting: r.meeting, status: r.status, source: r.source, submittedAt: r.submittedAt,
        ...(r.source === 'MANUAL'
          ? { corrected: true, adjustmentReason: r.adjustmentReason, adjustedAt: r.adjustedAt }
          : {}),
      })),
    };
  }

  // Rekap pengurus (PRD §14.4): search + sort di server + pagination.
  // OFFICER hanya divisinya (PRD §22.3); ADMIN global.
  // ponytail: agregasi in-memory (skala UKM). Ceiling: pindah ke GROUP BY + window function saat ribuan baris.
  async recapAll(actor: { role: string; division: string }, search: string | undefined, sortBy: string, order: 'asc' | 'desc', page: number, limit: number, from?: Date, to?: Date) {
    const allowed = ['name', 'present', 'permitted', 'sick', 'dispensation', 'absent', 'percentage'];
    if (!allowed.includes(sortBy)) throw new BadRequestException('Kolom sort tidak diizinkan');
    const users = await this.prisma.user.findMany({
      where: {
        ...divisionScope(actor),
        ...(search
          ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { nim: { contains: search, mode: 'insensitive' } }] }
          : {}),
      },
      select: { id: true, nim: true, name: true, division: true, cohortYear: true, status: true },
      orderBy: { name: 'asc' },
    });
    const groups = await this.prisma.attendance.groupBy({
      by: ['userId', 'status'],
      where: { userId: { in: users.map((u) => u.id) }, ...this.countedWhere(from, to) },
      _count: true,
    });
    const per = new Map<string, Record<string, number>>();
    for (const g of groups) {
      if (!per.has(g.userId)) per.set(g.userId, { PRESENT: 0, PERMITTED: 0, SICK: 0, DISPENSATION: 0, ABSENT: 0 });
      per.get(g.userId)![g.status] = Number(g._count);
    }
    const effList = await this.stats.effectiveList();
    const threshold = await this.config.get<number | null>('attendance_threshold_pct');
    const rows = users.map((u) => {
      const b = per.get(u.id) ?? { PRESENT: 0, PERMITTED: 0, SICK: 0, DISPENSATION: 0, ABSENT: 0 };
      const counted = b.PRESENT + b.PERMITTED + b.SICK + b.DISPENSATION + b.ABSENT;
      const eff = effList.reduce((s, k) => s + (b[k] ?? 0), 0);
      const pctVal = this.stats.pct(eff, counted);
      return {
        user: u, counted, present: b.PRESENT, permitted: b.PERMITTED, sick: b.SICK,
        dispensation: b.DISPENSATION, absent: b.ABSENT, percentage: pctVal,
        belowThreshold: threshold != null && pctVal !== null && pctVal < threshold,
      };
    });
    const key = sortBy === 'name' ? null : (sortBy as keyof (typeof rows)[number]);
    rows.sort((a, b) => {
      const av = key ? (a[key] ?? -1) : a.user.name;
      const bv = key ? (b[key] ?? -1) : b.user.name;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return order === 'asc' ? cmp : -cmp;
    });
    const total = rows.length;
    return { page, limit, total, data: rows.slice((page - 1) * limit, page * limit) };
  }
}
