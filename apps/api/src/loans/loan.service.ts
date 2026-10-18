import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrgConfigService } from '../config/org-config.service';
import { detectImage } from '../attendance/attendance.rules';
import { sanitizeImage } from '../storage/sanitize';
import { canManageMember, divisionScope } from '../common/policy';

@Injectable()
export class LoanService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private storage: StorageService,
    private notif: NotificationsService,
    private config: OrgConfigService,
  ) {}

  private photoKey(itemId: string) {
    return `loans/${itemId}/${randomUUID()}.jpg`;
  }

  private async hist(itemId: string, actorId: string | null, action: string, oldValue: string, newValue: string, note = '', tx?: any) {
    const db: any = tx ?? this.prisma;
    await db.itemHistory.create({ data: { itemId, actorId, action, oldValue, newValue, note } });
  }

  private async cleanPhoto(file?: Buffer): Promise<Buffer> {
    if (!file?.length) throw new BadRequestException('Foto wajib');
    const maxMb = await this.config.get<number>('max_upload_mb');
    if (file.length > maxMb * 1024 * 1024) throw new BadRequestException(`Maksimal ${maxMb} MB`);
    if (!detectImage(file)) throw new BadRequestException('Foto harus JPG/PNG/WebP');
    return sanitizeImage(file); // re-encode: buang EXIF + metadata.
  }

  async createItem(actorId: string, name: string, code: string, category: string, condition: string) {
    try {
      const item = await this.prisma.$transaction(async (tx: any) => {
        const it = await tx.item.create({ data: { name, code, category: category ?? '', condition: condition ?? 'Baik' } });
        await this.audit.log({ actorId, action: 'item.create', entity: 'Item', entityId: it.id, newValue: { name, code } as any }, tx);
        await this.hist(it.id, actorId, 'created', '', `${name} (${code})`, '', tx);
        return it;
      });
      return item;
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Kode barang sudah dipakai');
      throw e;
    }
  }

  async updateItem(actorId: string, id: string, dto: { name?: string; category?: string; condition?: string; status?: 'AVAILABLE' | 'MAINTENANCE' }) {
    const item = await this.prisma.item.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Tidak ditemukan');
    if (item.status === 'BORROWED') throw new BadRequestException('Barang sedang dipinjam');
    if (dto.status && !['AVAILABLE', 'MAINTENANCE'].includes(dto.status)) throw new BadRequestException('Status tidak valid');
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const u = await tx.item.update({ where: { id }, data: { ...dto } });
      await this.audit.log({ actorId, action: 'item.update', entity: 'Item', entityId: id, oldValue: { status: item.status, condition: item.condition } as any, newValue: { status: u.status, condition: u.condition } as any }, tx);
      if (item.condition !== u.condition || item.status !== u.status)
        await this.hist(id, actorId, 'updated', `${item.condition}/${item.status}`, `${u.condition}/${u.status}`, '', tx);
      return u;
    });
    return updated;
  }

  async itemHistory(id: string, page: number, limit: number) {
    const where = { itemId: id };
    const [total, data] = await Promise.all([
      this.prisma.itemHistory.count({ where }),
      this.prisma.itemHistory.findMany({ where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
    ]);
    return { page, limit, total, data };
  }

  async listItems(status?: string) {
    // B-06: string bebas → 400, bukan 500 dari enum Prisma.
    if (status && !['AVAILABLE', 'BORROWED', 'MAINTENANCE'].includes(status))
      throw new BadRequestException('Status tidak valid');
    return this.prisma.item.findMany({
      where: status ? { status: status as any } : {},
      orderBy: { name: 'asc' },
    });
  }

  async borrow(user: any, itemId: string, dueAt: Date, noteOut: string, photo: Buffer) {
    if (!(dueAt instanceof Date) || isNaN(+dueAt) || dueAt <= new Date()) throw new BadRequestException('Tenggat harus di masa depan');
    const clean = await this.cleanPhoto(photo);
    const key = this.photoKey(itemId);
    await this.storage.save(key, clean, 'image/jpeg');
    try {
      const loan = await this.prisma.$transaction(async (tx: any) => {
        // Cek di dalam tx: jendela balapan menyempit; P2002 tetap jaring terakhir.
        const item = await tx.item.findUnique({ where: { id: itemId } });
        if (!item) throw new NotFoundException('Barang tidak ditemukan');
        if (item.status !== 'AVAILABLE') throw new ConflictException(`Barang ${item.status === 'BORROWED' ? 'sedang dipinjam' : 'dalam perawatan'}`);
        const max = await this.config.get<number>('max_active_loans_per_member');
        const active = await tx.loan.count({ where: { borrowerId: user.id, status: { in: ['ACTIVE', 'OVERDUE'] } } });
        if (active >= max) throw new BadRequestException(`Maksimal ${max} pinjaman aktif`);
        const l = await tx.loan.create({
          data: {
            itemId, borrowerId: user.id,
            snapName: user.name, snapNim: user.nim, snapDivision: user.division ?? '', snapCohort: user.cohortYear ?? 0,
            photoOutKey: key, noteOut: noteOut ?? '', dueAt,
          },
        });
        // Conditional update: dua borrow konkuren → hanya satu yang dapat count 1 (indeks parsial + P2002 sebagai jaring terakhir).
        const claimed = await tx.item.updateMany({ where: { id: itemId, status: 'AVAILABLE' }, data: { status: 'BORROWED' } });
        if (!claimed.count) throw new ConflictException('Barang baru saja dipinjam orang lain');
        await this.audit.log({ actorId: user.id, action: 'loan.create', entity: 'Loan', entityId: l.id, newValue: { itemId, dueAt } as any }, tx);
        return l;
      });
      return loan;
    } catch (e: any) {
      await this.storage.remove(key);
      // Partial unique (satu aktif per barang) + validasi di atas; P2002 = balapan.
      if (e?.code === 'P2002') throw new ConflictException('Barang baru saja dipinjam orang lain');
      throw e;
    }
  }

  async returnLoan(actor: { id: string; role: string; division: string }, id: string, photo: Buffer, noteIn: string, damaged: boolean) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Tidak ditemukan');
    if (!['ACTIVE', 'OVERDUE'].includes(loan.status)) throw new BadRequestException('Sudah selesai');
    // Scope divisi (AGENTS §6): OFFICER hanya pinjaman anggota divisinya; peminjam sendiri boleh.
    if (loan.borrowerId !== actor.id) {
      const target = await this.prisma.user.findUnique({ where: { id: loan.borrowerId }, select: { id: true, division: true } });
      if (!target || !canManageMember(actor as any, target)) throw new ForbiddenException('Di luar divisi Anda');
    }
    const clean = await this.cleanPhoto(photo);
    const key = this.photoKey(loan.itemId);
    await this.storage.save(key, clean, 'image/jpeg');
    const now = new Date();
    let out;
    try {
      out = await this.prisma.$transaction(async (tx: any) => {
        const l = await tx.loan.update({
          where: { id }, data: { status: 'RETURNED', photoInKey: key, noteIn: noteIn ?? '', returnedAt: now },
        });
        await tx.item.update({ where: { id: loan.itemId }, data: { status: damaged ? 'MAINTENANCE' : 'AVAILABLE' } });
        await this.audit.log({
          actorId: actor.id, action: 'loan.return', entity: 'Loan', entityId: id,
          oldValue: { status: loan.status } as any, newValue: { status: 'RETURNED', damaged } as any,
        }, tx);
        await this.hist(loan.itemId, actor.id, damaged ? 'damaged' : 'returned', loan.status, damaged ? 'MAINTENANCE' : 'AVAILABLE', noteIn, tx);
        return l;
      });
    } catch (e) {
      await this.storage.remove(key);
      throw e;
    }
    await this.notif.notifyUsers([loan.borrowerId], 'loan-returned', 'Pengembalian diterima', '').catch(() => {});
    return out;
  }

  async cancel(userId: string, id: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan || loan.borrowerId !== userId) throw new NotFoundException('Tidak ditemukan');
    if (loan.status !== 'ACTIVE') throw new BadRequestException('Hanya yang aktif bisa dibatalkan');
    await this.prisma.$transaction(async (tx: any) => {
      await tx.loan.update({ where: { id }, data: { status: 'CANCELLED' } });
      await tx.item.update({ where: { id: loan.itemId }, data: { status: 'AVAILABLE' } });
    });
    if (loan.photoOutKey) await this.storage.remove(loan.photoOutKey);
    return { ok: true };
  }

  async myList(userId: string, page = 1, limit = 20) {
    const where = { borrowerId: userId };
    const [total, data] = await Promise.all([
      this.prisma.loan.count({ where }),
      this.prisma.loan.findMany({
        where,
        include: { item: { select: { id: true, name: true, code: true } } },
        orderBy: { borrowedAt: 'desc' },
        skip: (page - 1) * limit, take: Math.min(limit, 100),
      }),
    ]);
    return { page, limit, total, data };
  }

  async list(actor: { role: string; division: string }, status?: string, page = 1, limit = 20) {
    const where: any = {
      ...divisionScope(actor, 'borrower'),
      ...(status ? { status: status as any } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.loan.count({ where }),
      this.prisma.loan.findMany({
        where,
        include: { item: { select: { id: true, name: true, code: true } } },
        orderBy: { borrowedAt: 'desc' },
        skip: (page - 1) * limit, take: Math.min(limit, 100),
      }),
    ]);
    return { page, limit, total, data };
  }

  async photoUrl(user: any, id: string, which: string, baseUrl: string) {
    const loan = await this.prisma.loan.findUnique({ where: { id } });
    if (!loan) throw new NotFoundException('Tidak ditemukan');
    if (user.role === 'MEMBER' && loan.borrowerId !== user.id) throw new NotFoundException('Tidak ditemukan');
    if (user.role === 'OFFICER' && loan.borrowerId !== user.id) {
      const target = await this.prisma.user.findUnique({ where: { id: loan.borrowerId }, select: { id: true, division: true } });
      if (!target || !canManageMember(user, target)) throw new NotFoundException('Tidak ditemukan');
    }
    const key = which === 'in' ? loan.photoInKey : loan.photoOutKey;
    if (!key || loan.photoDeletedAt) throw new GoneException('File sudah dihapus');
    return { url: await this.storage.signedUrl(key, baseUrl) };
  }

  // Overdue + reminder H-1 (dipanggil dari tick; idempotent via WHERE/flag).
  // Notif hanya untuk yang BARU transisi (bukan seluruh OVERDUE tiap tick).
  async overdueTick(now = new Date()) {
    const newly = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE', dueAt: { lte: now } },
      select: { id: true, borrowerId: true },
    });
    let overdue = 0;
    if (newly.length) {
      const marked = await this.prisma.loan.updateMany({
        where: { id: { in: newly.map((l) => l.id) }, status: 'ACTIVE' },
        data: { status: 'OVERDUE' },
      });
      overdue = marked.count;
      if (overdue)
        await this.notif.notifyUsers([...new Set(newly.map((r) => r.borrowerId))], 'loan-overdue', 'Ada pinjaman lewat tenggat', '').catch(() => {});
    }
    const soon = new Date(now.getTime() + 24 * 86400_000);
    const due = await this.prisma.loan.findMany({
      where: { status: 'ACTIVE', dueRemindedAt: null, dueAt: { gte: now, lte: soon } },
      select: { id: true, borrowerId: true },
    });
    for (const l of due) {
      await this.notif.notifyUsers([l.borrowerId], 'loan-due', 'Pinjaman jatuh tempo besok', '').catch(() => {});
      await this.prisma.loan.update({ where: { id: l.id }, data: { dueRemindedAt: now } });
    }
    return { overdue, reminded: due.length };
  }
}
