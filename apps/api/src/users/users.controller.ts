import { Body, Controller, Get, Patch, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { IsArray, ArrayMinSize, ArrayMaxSize, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { parseMemberCsv } from '../common/csv';
import { canManageMember } from '../common/policy';

class CreateUserDto {
  @IsString() @MinLength(3) @MaxLength(32) nim!: string;
  @IsString() @MinLength(3) @MaxLength(100) name!: string;
  @IsString() @MinLength(10) @MaxLength(128) password!: string;
  @IsString() @IsOptional() role?: 'MEMBER' | 'OFFICER' | 'ADMIN';
  @IsString() @IsOptional() division?: string;
  @IsEmail() @IsOptional() email?: string;
  @IsInt() @IsOptional() @Type(() => Number) cohortYear?: number;
}

class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() division?: string;
}

class UpdateUserDto {
  @IsString() @IsOptional() @MinLength(3) @MaxLength(100) name?: string;
  @IsString() @IsOptional() @MaxLength(50) division?: string;
  @IsInt() @IsOptional() @Type(() => Number) cohortYear?: number;
  @IsEmail() @IsOptional() email?: string;
  @IsIn(['MEMBER', 'OFFICER', 'ADMIN']) @IsOptional() role?: 'MEMBER' | 'OFFICER' | 'ADMIN';
  @IsIn(['ACTIVE', 'INACTIVE']) @IsOptional() status?: 'ACTIVE' | 'INACTIVE';
}

class ImportDto {
  @IsString() @MaxLength(200_000) csv!: string;
}

class BulkDeactivateDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @IsUUID('4', { each: true }) ids!: string[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OFFICER', 'ADMIN')
@Controller('users')
export class UsersController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Post()
  async create(@Req() req: any, @Body() dto: CreateUserDto) {
    if (dto.role === 'ADMIN' && req.user.role !== 'ADMIN') {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Hanya ADMIN dapat membuat ADMIN');
    }
    if (req.user.role !== 'ADMIN' && dto.role && dto.role !== 'MEMBER') {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Hanya ADMIN dapat membuat OFFICER');
    }
    // Officer menambah ke divisinya sendiri (tanpa ini member yatim di luar scope).
    const division = req.user.role === 'ADMIN' ? (dto.division ?? '') : req.user.division;
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.$transaction(async (tx: any) => {
      const u = await tx.user.create({
        data: {
          nim: dto.nim,
          name: dto.name,
          passwordHash,
          role: (dto.role as any) ?? 'MEMBER',
          division,
          email: dto.email ?? null,
          cohortYear: dto.cohortYear ?? 0,
        },
      });
      await this.audit.log({
        actorId: req.user.id,
        action: 'user.create',
        entity: 'User',
        entityId: u.id,
        newValue: { nim: u.nim, role: u.role } as any,
      }, tx);
      return u;
    });
    const { passwordHash: _, ...safe } = user;
    return safe;
  }

  @Get()
  async list(@Req() req: any, @Query() q: ListQuery) {
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 20, 100);
    // Officer scope se-divisi (backlog); ADMIN bebas + boleh filter divisi.
    const division = req.user.role === 'ADMIN' ? q.division : req.user.division;
    const where: any = {
      ...(division !== undefined ? { division } : {}),
      ...(q.search
        ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { nim: { contains: q.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, nim: true, name: true, role: true, status: true, division: true, cohortYear: true, email: true, joinedAt: true },
      }),
    ]);
    return { page, limit, total, data };
  }

  @Patch(':id')
  async update(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateUserDto) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) {
      const { NotFoundException } = await import('@nestjs/common');
      throw new NotFoundException('User tidak ditemukan');
    }
    if (req.user.id !== target.id && !canManageMember(req.user, target)) {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Di luar divisi Anda');
    }
    // Role hanya oleh ADMIN (tutup promote member→officer oleh officer).
    if (dto.role !== undefined && dto.role !== target.role && req.user.role !== 'ADMIN') {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Hanya ADMIN dapat mengubah role');
    }
    // Pindah divisi = perluasan scope: hanya ADMIN (tutup eskalasi via edit diri sendiri).
    if (dto.division !== undefined && dto.division !== target.division && req.user.role !== 'ADMIN') {
      const { ForbiddenException } = await import('@nestjs/common');
      throw new ForbiddenException('Hanya ADMIN dapat memindahkan divisi');
    }
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.division !== undefined) data.division = dto.division;
    if (dto.cohortYear !== undefined) data.cohortYear = dto.cohortYear;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;
    // Keluar → INACTIVE + cabut sesi (PRD §7); bukan hapus. Aktif lagi → leftAt dikosongkan.
    if (dto.status !== undefined && dto.status !== target.status) {
      data.status = dto.status;
      data.leftAt = dto.status === 'INACTIVE' ? new Date() : null;
    }
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const u = await tx.user.update({ where: { id }, data });
      if (data.status === 'INACTIVE') await tx.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
      await this.audit.log(
        {
          actorId: req.user.id, action: 'user.update', entity: 'User', entityId: id,
          oldValue: { role: target.role, status: target.status } as any,
          newValue: { role: u.role, status: u.status } as any,
        },
        tx,
      );
      return u;
    });
    const { passwordHash: _, ...safe } = updated;
    return safe;
  }

  // Import CSV via JSON body (tanpa multipart — ponytail: cukup untuk M1).
  // Hasil per baris; maks 100 baris (konvensi bulk PRD §15.7).
  // Batch: 1 cek duplikat + 1 createMany + 1 audit (bukan N×(bcrypt+insert+audit)).
  @Post('import')
  async import(@Req() req: any, @Body() dto: ImportDto) {
    const { rows, errors } = parseMemberCsv(dto.csv);
    if (rows.length > 100) {
      const { BadRequestException } = await import('@nestjs/common');
      throw new BadRequestException('Maksimal 100 baris per import');
    }
    const results: { nim: string; status: 'ok' | 'failed'; reason?: string; temporaryPassword?: string }[] =
      errors.map((e) => ({ nim: `baris ${e.line}`, status: 'failed' as const, reason: e.reason }));
    const have = new Set(
      (await this.prisma.user.findMany({ where: { nim: { in: rows.map((r) => r.nim) } }, select: { nim: true } }))
        .map((u) => u.nim),
    );
    for (const r of rows.filter((x) => have.has(x.nim)))
      results.push({ nim: r.nim, status: 'failed', reason: 'NIM duplikat atau tidak valid' });
    const fresh = rows.filter((r) => !have.has(r.nim));
    const hashed = await Promise.all(fresh.map(async (r) => {
      const temp = randomBytes(9).toString('base64url');
      return { r, temp, hash: await bcrypt.hash(temp, 10) };
    }));
    if (hashed.length) {
      await this.prisma.user.createMany({
        data: hashed.map(({ r, hash }) => ({
          nim: r.nim, name: r.name,
          // Scope divisi (AGENTS §6): officer selalu ke divisinya sendiri, apa pun isi CSV.
          division: req.user.role === 'ADMIN' ? r.division : req.user.division,
          cohortYear: r.cohortYear, email: r.email ?? null,
          passwordHash: hash, role: 'MEMBER' as const, mustChangePassword: true,
        })),
        skipDuplicates: true, // balapan import konkuren: baris tabrakan dilewati, tak 500.
      });
      await this.audit.log({
        actorId: req.user.id, action: 'user.import', entity: 'User',
        entityId: `${hashed.length} via csv`, newValue: { count: hashed.length } as any,
      });
      for (const { r, temp } of hashed) results.push({ nim: r.nim, status: 'ok', temporaryPassword: temp });
    }
    return { total: results.length, results };
  }

  @Post('bulk-deactivate')
  async bulkDeactivate(@Req() req: any, @Body() dto: BulkDeactivateDto) {
    const results = [];
    for (const id of dto.ids) {
      try {
        await this.update(req, id, { status: 'INACTIVE' });
        results.push({ id, status: 'ok' });
      } catch (e: any) {
        results.push({ id, status: 'failed', reason: e?.message ?? 'Gagal' });
      }
    }
    return { total: results.length, results };
  }
}
