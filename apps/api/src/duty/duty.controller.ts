import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DutyService } from './duty.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

class RosterDto {
  @IsDate() @Type(() => Date) startDate!: Date;
  @IsInt() @Min(1) @Max(90) @Type(() => Number) days!: number;
  @IsOptional() @IsInt() @Min(1) @Max(5) @Type(() => Number) perDay?: number;
  @IsOptional() @IsString() @MaxLength(50) division?: string;
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) openTime?: string;
  @IsOptional() @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) closeTime?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(100) titlePrefix?: string;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DutyController {
  constructor(private duty: DutyService) {}

  @Roles('OFFICER', 'ADMIN')
  @Post('duty/roster')
  roster(@Req() req: any, @Body() dto: RosterDto) {
    return this.duty.generate(req.user, dto);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('duty/assignments/me')
  mine(@Req() req: any) {
    return this.duty.myAssignments(req.user.id);
  }

  @Roles('OFFICER', 'ADMIN')
  @Get('duty/assignments')
  byMeeting(@Query('meetingId', ParseUUIDPipe) meetingId: string) {
    return this.duty.assignmentsByMeeting(meetingId);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('duty/summary/me')
  mySummary(@Req() req: any) {
    return this.duty.summary(req.user, req.user.id);
  }

  @Roles('OFFICER', 'ADMIN')
  @Get('duty/summary')
  summary(@Req() req: any, @Query('userId', ParseUUIDPipe) userId: string) {
    return this.duty.summary(req.user, userId);
  }
}
