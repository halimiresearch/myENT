import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { canManageMember } from '../common/policy';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgConfigService } from '../config/org-config.service';
import { detectImage } from '../attendance/attendance.rules';
import { assertPdf, sanitizeImage } from '../storage/sanitize';
import { semesterStart } from './semester';
import { randomUUID } from 'crypto';

function isPdf(buf: Buffer) {
  return buf.length > 4 && buf.toString('ascii', 0, 4) === '%PDF';
}

@Injectable()
export class AbsenceService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private storage: StorageService,
    private notif: NotificationsService,
    private config: OrgConfigService,
  ) {}

  async create(userId: string, meetingId: string, reasonType: string, reasonDetail: string, file?: Buffer) {
    const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null } });
    if (!m || m.status === 'DRAFT') throw new NotFoundException('Meeting tidak ditemukan');
    if (m.status === 'CANCELLED') throw new BadRequestException('Kegiatan dibatalkan');
    if (new Date() > m.attendanceCloseAt)
      throw new BadRequestException('Batas pengajuan lewat. Hubungi pengurus');
    const att = await this.prisma.attendance.findUnique({ where: { userId_meetingId: { userId, meetingId } } });
    if (att?.status === 'PRESENT') throw new ConflictException('Sudah presensi'); // BR-15
    // Kuota izin per semester, bila diaktifkan (backlog §22.3; default tanpa batas).
    const quota = await this.config.get<number | null>('absence_quota_per_semester');
    if (quota != null) {
      const used = await this.prisma.absenceRequest.count({
        where: { userId, status: 'APPROVED', reviewedAt: { gte: semesterStart() } },
      });
      if (used >= quota) throw new BadRequestException(`Kuota izin semester habis (${quota})`);
    }
    let attachmentObjectKey: string | undefined;
    const maxMb = await this.config.get<number>('max_upload_mb');
    const required = await this.config.get<Record<string, boolean>>('attachment_required');
    if (file?.length) {
      if (file.length > maxMb * 1024 * 1024) throw new BadRequestException(`Maksimal ${maxMb} MB`);
      let mime: string;
      if (detectImage(file)) {
        file = await sanitizeImage(file);
        mime = 'image/jpeg';
      } else if (isPdf(file)) {
        assertPdf(file);
        mime = 'application/pdf';
      } else throw new BadRequestException('Lampiran harus foto/PDF');
      attachmentObjectKey = `attachments/${meetingId}/${userId}/${randomUUID()}`;
      await this.storage.save(attachmentObjectKey, file, mime);
    } else if (required[reasonType]) {
      throw new BadRequestException('Lampiran wajib untuk alasan ini');
    }
    try {
      const r = await this.prisma.absenceRequest.create({
        data: { userId, meetingId, reasonType: reasonType as any, reasonDetail: reasonDetail ?? '', attachmentObjectKey },
      });
      return r;
    } catch (e: any) {
      if (attachmentObjectKey) await this.storage.remove(attachmentObjectKey);
      if (e?.code === 'P2002') throw new ConflictException('Sudah ada request aktif'); // BR-18
      throw e;
    }
  }

  async myList(userId: string, page: number, limit: number) {
    const where = { userId };
    const [total, data] = await Promise.all([
      this.prisma.absenceRequest.count({ where }),
      this.prisma.absenceRequest.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'desc' } }),
    ]);
    return { page, limit, total, data };
  }

  async listByMeeting(actor: { id: string; role: string; division: string }, meetingId: string, page: number, limit: number, status?: string) {
    const where: any = {
      meetingId,
      ...(status ? { status } : {}),
      // Officer scope se-divisi (backlog); ADMIN bebas.
      ...(actor.role === 'ADMIN' ? {} : { user: { division: actor.division } }),
    };
    const [total, data] = await Promise.all([
      this.prisma.absenceRequest.count({ where }),
      this.prisma.absenceRequest.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'asc' },
        include: { user: { select: { id: true, nim: true, name: true } } },
      }),
    ]);
    return { page, limit, total, data };
  }

  async cancel(userId: string, id: string) {
    const r = await this.prisma.absenceRequest.findUnique({ where: { id } });
    if (!r || r.userId !== userId) throw new NotFoundException('Tidak ditemukan');
    if (r.status !== 'PENDING') throw new BadRequestException('Hanya PENDING yang bisa ditarik');
    return this.prisma.absenceRequest.update({ where: { id }, data: { status: 'CANCELLED' } });
  }

  // BR-07: update request + upsert attendance + audit dalam satu transaksi.
  async decide(actor: { id: string; role: string; division: string }, id: string, approve: boolean, reviewNote: string) {
    const out = await this.prisma.$transaction(async (tx: any) => {
      const r = await tx.absenceRequest.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Tidak ditemukan');
      if (r.status !== 'PENDING') throw new BadRequestException('Sudah diputuskan');
      if (r.userId === actor.id) throw new ForbiddenException('Tidak boleh memutus request sendiri');
      const target = await tx.user.findUnique({ where: { id: r.userId }, select: { id: true, division: true } });
      if (!target || !canManageMember(actor as any, target as any))
        throw new ForbiddenException('Di luar divisi Anda');
      const reviewerId = actor.id;
      const now = new Date();
      if (approve) {
        const mapping = await this.config.get<Record<string, 'SICK' | 'PERMITTED' | 'DISPENSATION'>>('approval_mapping');
        const status = mapping[r.reasonType];
        const existing = await tx.attendance.findUnique({
          where: { userId_meetingId: { userId: r.userId, meetingId: r.meetingId } },
        });
        if (existing?.status === 'PRESENT') throw new ConflictException('Sudah PRESENT'); // BR-15
        // Conditional update: dua officer konkuren → hanya satu yang dapat count 1.
        const claimed = await tx.absenceRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'APPROVED', reviewerId, reviewNote: reviewNote ?? '', reviewedAt: now },
        });
        if (!claimed.count) throw new BadRequestException('Sudah diputuskan');
        if (existing) {
          await tx.attendance.update({
            where: { id: existing.id },
            data: { status, source: 'ABSENCE_APPROVAL', adjustedAt: now, adjustmentReason: `Approval: ${reviewNote ?? ''}` },
          });
        } else {
          try {
            await tx.attendance.create({
              data: { userId: r.userId, meetingId: r.meetingId, status, source: 'ABSENCE_APPROVAL', submittedAt: now },
            });
          } catch (e: any) {
            if (e?.code === 'P2002') throw new ConflictException('Sudah presensi');
            throw e;
          }
        }
        await this.audit.log(
          { actorId: reviewerId, action: 'absence.approve', entity: 'AbsenceRequest', entityId: id, oldValue: { status: 'PENDING' } as any, newValue: { status } as any },
          tx,
        );
      } else {
        const claimed = await tx.absenceRequest.updateMany({
          where: { id, status: 'PENDING' },
          data: { status: 'REJECTED', reviewerId, reviewNote: reviewNote ?? '', reviewedAt: now },
        });
        if (!claimed.count) throw new BadRequestException('Sudah diputuskan');
        await this.audit.log(
          { actorId: reviewerId, action: 'absence.reject', entity: 'AbsenceRequest', entityId: id, oldValue: { status: 'PENDING' } as any, newValue: { status: 'REJECTED' } as any },
          tx,
        );
      }
      return tx.absenceRequest.findUnique({ where: { id } });
    });
    // Notifikasi hasil (di luar transaksi; gagal kirim tak menggagalkan keputusan).
    const m = await this.prisma.meeting.findUnique({ where: { id: out.meetingId }, select: { title: true } });
    await this.notif
      .notifyUsers([out.userId], approve ? 'request-approved' : 'request-rejected',
        `Request ${approve ? 'diterima' : 'ditolak'}: ${m?.title ?? ''}`, reviewNote ?? '',
        { refType: 'AbsenceRequest', refId: id })
      .catch(() => {});
    return out;
  }

}
