import { Body, Controller, Delete, Get, Patch, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { NotificationsService } from './notifications.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

export class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  // B-17: Boolean('false') = true; query string dikonversi eksplisit, nilai asing ditolak validasi.
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() unreadOnly?: boolean;
}

class DeviceDto {
  @IsString() @MinLength(10) @MaxLength(512) token!: string;
}

class AnnounceDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @IsOptional() @MaxLength(2000) body?: string;
  @IsString() @IsOptional() @MaxLength(50) division?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) cohortYear?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class NotificationsController {
  constructor(
    private notif: NotificationsService,
    private audit: AuditService,
  ) {}

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('notifications/me')
  async me(@Req() req: any, @Query() q: PageQuery) {
    return this.notif.inbox(req.user.id, q.page ?? 1, Math.min(q.limit ?? 20, 100), q.unreadOnly);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Patch('notifications/:id/read')
  async read(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.notif.markRead(req.user.id, id);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Post('notifications/devices')
  async register(@Req() req: any, @Body() dto: DeviceDto) {
    return this.notif.registerDevice(req.user.id, dto.token);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Delete('notifications/devices')
  async unregister(@Req() req: any, @Body() dto: DeviceDto) {
    return this.notif.unregisterDevice(req.user.id, dto.token);
  }

  @Roles('OFFICER', 'ADMIN')
  @Post('announcements')
  async announce(@Req() req: any, @Body() dto: AnnounceDto) {
    const r = await this.notif.broadcast(dto.division, 'announcement', dto.title, dto.body ?? '', dto.cohortYear);
    await this.audit.log({
      actorId: req.user.id, action: 'announcement.create', entity: 'Announcement',
      entityId: `${Date.now()}`, newValue: { title: dto.title, count: r.count, division: dto.division ?? null, cohortYear: dto.cohortYear ?? null } as any,
    });
    return r;
  }
}
