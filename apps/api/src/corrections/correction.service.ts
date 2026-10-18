import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AttendanceService } from '../attendance/attendance.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { OrgConfigService } from '../config/org-config.service';
import { detectImage } from '../attendance/attendance.rules';
import { isPdf } from '../materials/materials.service';
import { assertPdf, sanitizeImage } from '../storage/sanitize';
import { canManageMember } from '../common/policy';
import { randomUUID } from 'crypto';

// Klaim koreksi anggota (backlog §22.3): "sebenarnya hadir tapi lupa presensi".
// Anti-klain-palsu: satu aktif, window terbuka → disuruh presensi, approve = MANUAL + audit.
@Injectable()
export class CorrectionService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private attendance: AttendanceService,
    private notif: NotificationsService,
    private storage: StorageService,
    private config: OrgConfigService,
  ) {}

  async create(userId: string, meetingId: string, claim: string, file?: Buffer) {
    const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null } });
    if (!m || m.status === 'DRAFT') throw new NotFoundException('Meeting tidak ditemukan');
    const now = new Date();
    if (now <= m.attendanceCloseAt)
      throw new BadRequestException('Window masih terbuka. Presensi langsung saja');
    // P2-01: klaim kedaluwarsa N hari setelah window tutup — jangan berbulan-bulan.
    const windowDays = await this.config.get<number>('correction_window_days');
    if (now.getTime() > m.attendanceCloseAt.getTime() + windowDays * 86400_000)
      throw new BadRequestException(`Masa koreksi habis (maks ${windowDays} hari setelah kegiatan)`);
    const att = await this.prisma.attendance.findUnique({ where: { userId_meetingId: { userId, meetingId } } });
    if (att?.status === 'PRESENT') throw new ConflictException('Sudah tercatat hadir');
    let attachmentObjectKey: string | undefined;
    if (file?.length) {
      const maxMb = await this.config.get<number>('max_upload_mb');
      if (file.length > maxMb * 1024 * 1024) throw new BadRequestException(`Maksimal ${maxMb} MB`);
      let mime: string;
      if (detectImage(file)) {
        file = await sanitizeImage(file);
        mime = 'image/jpeg';
      } else if (isPdf(file)) {
        assertPdf(file);
        mime = 'application/pdf';
      } else throw new BadRequestException('Bukti harus foto/PDF');
      attachmentObjectKey = `corrections/${meetingId}/${userId}/${randomUUID()}`;
      await this.storage.save(attachmentObjectKey, file, mime);
    }
    try {
      return await this.prisma.correctionRequest.create({ data: { userId, meetingId, claim, attachmentObjectKey } });
    } catch (e: any) {
      if (attachmentObjectKey) await this.storage.remove(attachmentObjectKey);
      if (e?.code === 'P2002') throw new ConflictException('Sudah ada klaim aktif');
      throw e;
    }
  }

  async myList(userId: string, page: number, limit: number) {
    const where = { userId };
    const [total, data] = await Promise.all([
      this.prisma.correctionRequest.count({ where }),
      this.prisma.correctionRequest.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'desc' } }),
    ]);
    return { page, limit, total, data };
  }

  async listByMeeting(actor: { role: string; division: string }, meetingId: string, page: number, limit: number) {
    const where: any = {
      meetingId,
      ...(actor.role === 'ADMIN' ? {} : { user: { division: actor.division } }),
    };
    const [total, data] = await Promise.all([
      this.prisma.correctionRequest.count({ where }),
      this.prisma.correctionRequest.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'asc' },
        include: { user: { select: { id: true, nim: true, name: true } } },
      }),
    ]);
    return { page, limit, total, data };
  }

  async cancel(userId: string, id: string) {
    const r = await this.prisma.correctionRequest.findUnique({ where: { id } });
    if (!r || r.userId !== userId) throw new NotFoundException('Tidak ditemukan');
    if (r.status !== 'PENDING') throw new BadRequestException('Hanya PENDING yang bisa ditarik');
    return this.prisma.correctionRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  // Satu transaksi: claim PENDING + adjust PRESENT + audit + APPROVED (KURANG.md §2).
  // Tak ada lagi PRESENT tanpa APPROVED atau APPROVED tanpa attendance. Notif setelah commit.
  async decide(actor: { id: string; role: string; division: string }, id: string, approve: boolean, reviewNote: string) {
    const r = await this.prisma.correctionRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Tidak ditemukan');
    if (r.status !== 'PENDING') throw new BadRequestException('Sudah diputuskan');
    if (r.userId === actor.id) throw new ForbiddenException('Tidak boleh memutus klaim sendiri');
    const target = await this.prisma.user.findUnique({ where: { id: r.userId }, select: { id: true, division: true } });
    if (!target || !canManageMember(actor as any, target as any)) throw new ForbiddenException('Di luar divisi Anda');
    const now = new Date();
    const reason = `Klaim anggota disetujui: ${reviewNote ?? ''}`;
    const out = await this.prisma.$transaction(async (tx: any) => {
      // Conditional update: dua reviewer konkuren → hanya satu yang dapat count 1.
      const claimed = await tx.correctionRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: approve ? 'APPROVED' : 'REJECTED', reviewerId: actor.id, reviewNote: reviewNote ?? '', reviewedAt: now },
      });
      if (!claimed.count) throw new BadRequestException('Sudah diputuskan');
      let attId: string | undefined;
      if (approve) {
        const a = await this.attendance.adjust(actor, r.meetingId, r.userId, 'PRESENT', reason, tx, true);
        attId = a.id;
      }
      await this.audit.log({
        actorId: actor.id, action: approve ? 'correction.approve' : 'correction.reject',
        entity: 'CorrectionRequest', entityId: id,
        oldValue: { status: 'PENDING' } as any,
        newValue: { status: approve ? 'APPROVED' : 'REJECTED' } as any,
      }, tx);
      const u = await tx.correctionRequest.findUniqueOrThrow({ where: { id } });
      return { claim: u, attId };
    });
    if (approve && out.attId)
      await this.notif.notifyUsers([r.userId], 'attendance-adjusted', `Kehadiran dikoreksi pengurus`, reason,
        { refType: 'Attendance', refId: out.attId }).catch(() => {});
    return out.claim;
  }
}
