import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AssignmentsService } from './assignments.service';
import { baseFromReq } from '../storage/storage.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

class CreateDto {
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
  @IsUUID() @IsOptional() meetingId?: string;
  @IsDate() @Type(() => Date) deadline!: Date;
}

class ReviewDto {
  @IsString() @IsOptional() @MaxLength(1000) reviewNote?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class AssignmentsController {
  constructor(private assignments: AssignmentsService) {}

  @Roles('OFFICER', 'ADMIN')
  @Post('assignments')
  @UseInterceptors(FileInterceptor('attachment', { limits: { files: 1, fileSize: 20 * 1024 * 1024 } }))
  create(@Req() req: any, @Body() dto: CreateDto, @UploadedFile() file?: Express.Multer.File) {
    return this.assignments.create(req.user.id, dto.title, dto.description ?? '', dto.meetingId, dto.deadline, file?.buffer);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('assignments')
  list(@Query() q: PageQuery) {
    return this.assignments.list(q.page ?? 1, Math.min(q.limit ?? 20, 100));
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Post('assignments/:id/submissions')
  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 20 * 1024 * 1024 } }))
  submit(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.assignments.submit(req.user.id, id, file?.buffer ?? Buffer.alloc(0));
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('submissions/me')
  myList(@Req() req: any, @Query() q: PageQuery) {
    return this.assignments.myList(req.user.id, q.page ?? 1, Math.min(q.limit ?? 20, 100));
  }

  @Roles('OFFICER', 'ADMIN')
  @Get('assignments/:id/submissions')
  byAssignment(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return this.assignments.listSubmissions(req.user, id, q.page ?? 1, Math.min(q.limit ?? 20, 100));
  }

  @Roles('OFFICER', 'ADMIN')
  @Patch('submissions/:id/review')
  review(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    return this.assignments.review(req.user, id, dto.reviewNote ?? '');
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('submissions/:id/file')
  file(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.assignments.fileUrl(req.user, id, baseFromReq(req));
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('assignments/:id/file')
  assignmentFile(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    return this.assignments.attachmentUrl(id, baseFromReq(req));
  }
}
