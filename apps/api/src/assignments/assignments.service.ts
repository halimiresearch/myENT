import { BadRequestException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, extFor } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgConfigService } from '../config/org-config.service';
import { detectImage } from '../attendance/attendance.rules';
import { isPdf } from '../materials/materials.service';
import { assertPdf, sanitizeImage } from '../storage/sanitize';
import { canManageMember, divisionScope } from '../common/policy';

// Status submission diturunkan (PRD §15.3): REVIEWED > LATE > SUBMITTED (tanpa record = NOT_SUBMITTED).
export function submissionStatus(s: { submittedAt: Date; reviewedAt: Date | null }, deadline: Date) {
  if (s.reviewedAt) return 'REVIEWED';
  return s.submittedAt > deadline ? 'LATE' : 'SUBMITTED';
}

@Injectable()
export class AssignmentsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private audit: AuditService,
    private notif: NotificationsService,
    private config: OrgConfigService,
  ) {}

  async create(actorId: string, title: string, description: string, meetingId: string | undefined, deadline: Date, file?: Buffer) {
    if (!(deadline instanceof Date) || isNaN(+deadline)) throw new BadRequestException('Deadline tidak valid');
    if (meetingId) {
      const m = await this.prisma.meeting.findFirst({ where: { id: meetingId, deletedAt: null }, select: { id: true } });
      if (!m) throw new BadRequestException('Meeting tidak ditemukan');
    }
    let attachmentKey: string | undefined;
    if (file?.length) {
      const maxMb = await this.config.get<number>('max_material_mb');
      if (file.length > maxMb * 1024 * 1024) throw new BadRequestException(`Maksimal ${maxMb} MB`);
      let mime: string;
      if (detectImage(file)) {
        file = await sanitizeImage(file);
        mime = 'image/jpeg';
      } else if (isPdf(file)) {
        assertPdf(file);
        mime = 'application/pdf';
      } else throw new BadRequestException('Lampiran harus PDF/foto');
      attachmentKey = `assignments/${randomUUID()}${extFor(mime)}`;
      await this.storage.save(attachmentKey, file, mime);
    }
    let a;
    try {
      a = await this.prisma.$transaction(async (tx: any) => {
        const row = await tx.assignment.create({
          data: { title, description: description ?? '', meetingId: meetingId || null, deadline, attachmentKey, creatorId: actorId },
        });
        await this.audit.log({ actorId, action: 'assignment.create', entity: 'Assignment', entityId: row.id, newValue: { title } as any }, tx);
        return row;
      });
    } catch (e) {
      if (attachmentKey) await this.storage.remove(attachmentKey);
      throw e;
    }
    await this.notif.broadcast(undefined, 'assignment', `Tugas baru: ${title}`, '').catch(() => {});
    return a;
  }

  async list(page: number, limit: number) {
    const [total, data] = await Promise.all([
      this.prisma.assignment.count(),
      this.prisma.assignment.findMany({
        skip: (page - 1) * limit, take: limit, orderBy: { deadline: 'asc' },
        include: { creator: { select: { id: true, name: true } }, _count: { select: { submissions: true } } },
      }),
    ]);
    return { page, limit, total, data };
  }

  async submit(userId: string, assignmentId: string, file: Buffer) {
    const a = await this.prisma.assignment.findUnique({ where: { id: assignmentId } });
    if (!a) throw new NotFoundException('Tugas tidak ditemukan');
    if (!file?.length) throw new BadRequestException('File wajib');
    const maxMb = await this.config.get<number>('max_upload_mb');
    if (file.length > maxMb * 1024 * 1024) throw new BadRequestException(`Maksimal ${maxMb} MB`);
    let mime: string;
    if (detectImage(file)) {
      file = await sanitizeImage(file);
      mime = 'image/jpeg';
    } else if (isPdf(file)) {
      assertPdf(file);
      mime = 'application/pdf';
    } else throw new BadRequestException('File harus PDF/foto');
    const key = `submissions/${assignmentId}/${userId}/${randomUUID()}${extFor(mime)}`;
    await this.storage.save(key, file, mime);
    const now = new Date();
    const prev = await this.prisma.submission.findUnique({ where: { assignmentId_userId: { assignmentId, userId } } });
    let out;
    try {
      out = await this.prisma.submission.upsert({
        where: { assignmentId_userId: { assignmentId, userId } },
        create: { assignmentId, userId, objectKey: key, submittedAt: now },
        update: { objectKey: key, submittedAt: now, reviewedAt: null, reviewNote: '' },
      });
    } catch (e) {
      await this.storage.remove(key); // upsert gagal → key baru jangan yatim.
      throw e;
    }
    if (prev && prev.objectKey !== key) await this.storage.remove(prev.objectKey).catch(() => {});
    // Kumpul ulang setelah review = review hangus; catat agar tak hilang diam-diam.
    if (prev?.reviewedAt)
      await this.audit.log({
        actorId: userId, action: 'submission.resubmit', entity: 'Submission', entityId: out.id,
        oldValue: { reviewedAt: prev.reviewedAt } as any, newValue: { submittedAt: now } as any,
      }).catch(() => {});
    return out;
  }

  async myList(userId: string, page: number, limit: number) {
    const [total, subs] = await Promise.all([
      this.prisma.submission.count({ where: { userId } }),
      this.prisma.submission.findMany({
        where: { userId }, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'desc' },
        include: { assignment: { select: { id: true, title: true, deadline: true } } },
      }),
    ]);
    return {
      page, limit, total,
      data: subs.map((s) => ({ ...s, status: submissionStatus(s, s.assignment.deadline) })),
    };
  }

  async listSubmissions(actor: { role: string; division: string }, assignmentId: string, page: number, limit: number) {
    const where: any = { assignmentId, ...divisionScope(actor, 'user') };
    const [total, subs] = await Promise.all([
      this.prisma.submission.count({ where }),
      this.prisma.submission.findMany({
        where, skip: (page - 1) * limit, take: limit, orderBy: { submittedAt: 'asc' },
        include: {
          user: { select: { id: true, nim: true, name: true } },
          assignment: { select: { deadline: true } },
        },
      }),
    ]);
    return {
      page, limit, total,
      data: subs.map((s) => ({ ...s, status: submissionStatus(s, s.assignment.deadline) })),
    };
  }

  async review(actor: { id: string; role: string; division: string }, id: string, reviewNote: string) {
    const s = await this.prisma.submission.findUnique({
      where: { id },
      include: { user: { select: { id: true, division: true } } },
    });
    if (!s) throw new NotFoundException('Tidak ditemukan');
    if (!canManageMember(actor as any, s.user as any)) throw new ForbiddenException('Di luar divisi Anda');
    return this.prisma.$transaction(async (tx: any) => {
      const u = await tx.submission.update({ where: { id }, data: { reviewedAt: new Date(), reviewNote: reviewNote ?? '' } });
      await this.audit.log({
        actorId: actor.id, action: 'submission.review', entity: 'Submission', entityId: id,
        oldValue: { reviewedAt: s.reviewedAt } as any, newValue: { reviewedAt: u.reviewedAt } as any,
      }, tx);
      return u;
    });
  }

  async fileUrl(user: any, submissionId: string, baseUrl: string) {
    const s = await this.prisma.submission.findUnique({ where: { id: submissionId } });
    if (!s) throw new NotFoundException('Tidak ditemukan');
    if (user.role === 'MEMBER' && s.userId !== user.id) throw new NotFoundException('Tidak ditemukan');
    if (user.role === 'OFFICER' && s.userId !== user.id) {
      const target = await this.prisma.user.findUnique({ where: { id: s.userId }, select: { id: true, division: true } });
      if (!target || !canManageMember(user, target)) throw new NotFoundException('Tidak ditemukan');
    }
    if (s.fileDeletedAt) throw new GoneException('File sudah dihapus');
    return { url: await this.storage.signedUrl(s.objectKey, baseUrl) };
  }

  // B-17: unduh lampiran tugas (brief). Materi internal — semua role yang login boleh baca.
  async attachmentUrl(id: string, baseUrl: string) {
    const a = await this.prisma.assignment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Tidak ditemukan');
    if (!a.attachmentKey) throw new NotFoundException('Tidak ada lampiran');
    return { url: await this.storage.signedUrl(a.attachmentKey, baseUrl) };
  }
}
