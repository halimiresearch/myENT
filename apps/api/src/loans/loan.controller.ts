import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { LoanService } from './loan.service';
import { baseFromReq } from '../storage/storage.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

class ItemDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(2) @MaxLength(20) code!: string;
  @IsString() @IsOptional() @MaxLength(50) category?: string;
  @IsString() @IsOptional() @MaxLength(500) condition?: string;
}

class UpdateItemDto {
  @IsString() @IsOptional() @MinLength(2) @MaxLength(100) name?: string;
  @IsString() @IsOptional() @MaxLength(50) category?: string;
  @IsString() @IsOptional() @MaxLength(500) condition?: string;
  @IsOptional() @IsIn(['AVAILABLE', 'MAINTENANCE']) status?: 'AVAILABLE' | 'MAINTENANCE';
}

class ReturnDto {
  @IsString() @IsOptional() @MaxLength(500) noteIn?: string;
  @IsOptional() damaged?: boolean;
}

class BorrowDto {
  @IsUUID() itemId!: string;
  @IsDate() @Type(() => Date) dueAt!: Date;
  @IsString() @IsOptional() @MaxLength(500) noteOut?: string;
}

class PageQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class LoanController {
  constructor(private loans: LoanService) {}

  @Roles('OFFICER', 'ADMIN')
  @Post('items')
  createItem(@Req() req: any, @Body() dto: ItemDto) {
    return this.loans.createItem(req.user.id, dto.name, dto.code, dto.category ?? '', dto.condition ?? 'Baik');
  }

  @Roles('OFFICER', 'ADMIN')
  @Patch('items/:id')
  updateItem(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateItemDto) {
    return this.loans.updateItem(req.user.id, id, dto);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('items')
  items(@Query('status') status?: string) {
    return this.loans.listItems(status);
  }

  @Roles('OFFICER', 'ADMIN')
  @Get('items/:id/history')
  history(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    return this.loans.itemHistory(id, q.page ?? 1, Math.min(q.limit ?? 20, 100));
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Post('loans')
  @UseInterceptors(FileInterceptor('photo', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  borrow(
    @Req() req: any,
    @Body() body: BorrowDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.loans.borrow(req.user, body.itemId, body.dueAt, body.noteOut ?? '', file?.buffer ?? Buffer.alloc(0));
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('loans/me')
  mine(@Req() req: any, @Query() q: PageQuery) {
    return this.loans.myList(req.user.id, q.page ?? 1, Math.min(q.limit ?? 20, 100));
  }

  @Roles('OFFICER', 'ADMIN')
  @Get('loans')
  all(@Req() req: any, @Query() q: PageQuery & { status?: string }) {
    return this.loans.list(req.user, q.status, q.page ?? 1, Math.min(q.limit ?? 20, 100));
  }

  @Roles('OFFICER', 'ADMIN')
  @Post('loans/:id/return')
  @UseInterceptors(FileInterceptor('photo', { limits: { files: 1, fileSize: 5 * 1024 * 1024 } }))
  back(
    @Req() req: any,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReturnDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.loans.returnLoan(req.user, id, file?.buffer ?? Buffer.alloc(0), body.noteIn ?? '', body.damaged === true || (body as any).damaged === 'true');
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Post('loans/:id/cancel')
  cancel(@Req() req: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.loans.cancel(req.user.id, id);
  }

  @Roles('MEMBER', 'OFFICER', 'ADMIN')
  @Get('loans/:id/photo')
  photo(@Req() req: any, @Param('id', ParseUUIDPipe) id: string, @Query('which') which?: string) {
    return this.loans.photoUrl(req.user, id, which === 'in' ? 'in' : 'out', baseFromReq(req));
  }
}
